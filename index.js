/**
 * dsh-studio（应用内中文名「工作台」）的 Host 半部。
 *
 * 提供三个同源只读/受限写入端点：
 * - `GET /dsh-studio/skills`：按两类返回技能。`global` 是 Host 全局技能层
 *   （`skills.snapshot({})`，宿主级插件注册的技能）；`user` 是用户级技能目录
 *   （`~/.dsh/skills`、`~/.agents/skills`）发现的技能，读取时临时取默认预设的
 *   只读作用域并只保留 `source` 为 `user-dsh` / `user-agents` 的条目。
 * - `GET|PUT /dsh-studio/settings`：工作台自己的界面开关（左下角两个提示、
 *   余额自动更新与主题皮肤）。设置保存在
 *   `$DSH_HOME/dsh-studio/settings.json`，跨页面刷新与重启保留。
 * - `POST /dsh-studio/diagnostic`：Client 半部把渲染错误写进日志。
 *
 * 这些端点都沿用 DSH 连接层既有的准入规则（`connection.requestRejection`）：
 * 只接受同一来源、且携带已认证浏览器会话的请求；读取仅在本机进行，不写入
 * 会话日志，也不发起模型请求。
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'studio-host'

/** 需要 Web 服务器承载端点；没有 Web 界面的 profile 不会激活本行。 */
export const inject = ['webServer']

/** 技能端点：与 Client 半部约定的固定路径。 */
const SKILLS_ROUTE = '/dsh-studio/skills'
/** 设置端点：读取与写入工作台的界面开关。 */
const SETTINGS_ROUTE = '/dsh-studio/settings'
/** 诊断端点：Client 半部把渲染错误写到这里，便于白屏时定位。 */
const DIAGNOSTIC_ROUTE = '/dsh-studio/diagnostic'

/** 用户级技能目录对应的来源标记。 */
const USER_SKILL_SOURCES = new Set(['user-dsh', 'user-agents'])

/** 请求体上限：设置 4 KiB、诊断 16 KiB。 */
const MAX_SETTINGS_BODY_BYTES = 4096
const MAX_DIAGNOSTIC_BODY_BYTES = 16384

/** 工作台可持久化的设置键。 */
const SETTING_KEYS = ['pricingIndicator', 'balanceIndicator', 'balanceRefreshMs', 'themeSkin']

/** 余额自动更新间隔的可选值（毫秒）；0 表示关闭。 */
const BALANCE_REFRESH_OPTIONS = [0, 10000, 30000, 60000, 300000]

/** 内置主题皮肤：default 使用 DSH 当前主题，sea 为浅海晨汐，night 为深海夜航。 */
const THEME_SKIN_OPTIONS = ['default', 'sea', 'night']

/** 默认设置：提示与主题皮肤都默认关闭，由用户在工作台里打开。 */
const DEFAULT_SETTINGS = {
  pricingIndicator: false,
  balanceIndicator: false,
  balanceRefreshMs: 0,
  themeSkin: 'default',
}

/**
 * 注册端点。
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 插件上下文。
 */
export function apply(ctx) {
  // 端点随本行卸载一起移除。
  ctx.effect(() => {
    const disposeSkills = ctx.webServer.register({
      kind: 'exact',
      path: SKILLS_ROUTE,
      handler: (req, res) => handleSkills(ctx, req, res),
    })
    const disposeSettings = ctx.webServer.register({
      kind: 'exact',
      path: SETTINGS_ROUTE,
      handler: (req, res) => handleSettings(ctx, req, res),
    })
    const disposeDiagnostic = ctx.webServer.register({
      kind: 'exact',
      path: DIAGNOSTIC_ROUTE,
      handler: (req, res) => handleDiagnostic(ctx, req, res),
    })
    return () => {
      disposeSkills()
      disposeSettings()
      disposeDiagnostic()
    }
  }, 'dsh-studio: skills, settings and diagnostic routes')
}

/**
 * 准入检查：与 /api 相同的 Host/来源栅栏与浏览器会话认证。
 * @param {any} ctx Host 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @returns {boolean} 是否已通过准入（未通过时已经写出响应）。
 */
function admitRequest(ctx, req, res) {
  const connection = ctx.get('connection')
  if (connection === undefined) {
    sendJson(res, 503, { error: 'connection service is unavailable' })
    return false
  }
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) {
    res.writeHead(rejection, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return false
  }
  return true
}

/**
 * 技能端点：准入 → 读取两类技能 → JSON。
 * @param {any} ctx Host 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 */
async function handleSkills(ctx, req, res) {
  if (!admitRequest(ctx, req, res)) return
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
    res.end()
    return
  }
  const skills = ctx.get('skills')
  if (skills === undefined) {
    sendJson(res, 503, { error: 'skill registry is unavailable' })
    return
  }
  try {
    const globalSnapshot = await skills.snapshot({})
    const userResult = await listUserSkills(ctx, skills)
    const body = JSON.stringify({
      global: globalSnapshot.skills.map(toSkillEntry),
      user: userResult.skills.map(toSkillEntry),
      complete: globalSnapshot.complete && userResult.complete,
    })
    sendBody(res, req.method === 'HEAD', 200, body)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 设置端点：GET/HEAD 读取，PUT 写入（只接受完整设置对象）。
 * @param {any} ctx Host 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 */
async function handleSettings(ctx, req, res) {
  if (!admitRequest(ctx, req, res)) return
  if (req.method === 'GET' || req.method === 'HEAD') {
    const settings = await readSettings()
    sendBody(res, req.method === 'HEAD', 200, JSON.stringify(settings))
    return
  }
  if (req.method !== 'PUT') {
    res.writeHead(405, { allow: 'GET, HEAD, PUT', 'cache-control': 'no-store' })
    res.end()
    return
  }
  let payload
  try {
    payload = await readJsonBody(req, MAX_SETTINGS_BODY_BYTES)
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    return
  }
  if (payload === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    sendJson(res, 400, { error: `body must be an object with at least one of ${SETTING_KEYS.join(', ')}` })
    return
  }
  // 只接受已知设置；PUT 是局部更新，未提供的设置保持原值。
  const patch = {}
  for (const key of SETTING_KEYS) {
    if (!Object.hasOwn(payload, key)) continue
    if (key === 'balanceRefreshMs') {
      // 与 Client 下拉框的可选项保持一致，避免写入无效间隔导致轮询异常。
      if (!BALANCE_REFRESH_OPTIONS.includes(payload[key])) {
        sendJson(res, 400, { error: `${key} must be one of ${BALANCE_REFRESH_OPTIONS.join(', ')}` })
        return
      }
    } else if (key === 'themeSkin') {
      // 仅接受客户端提供的主题标识，旧设置继续使用原值。
      if (!THEME_SKIN_OPTIONS.includes(payload[key])) {
        sendJson(res, 400, { error: `${key} must be one of ${THEME_SKIN_OPTIONS.join(', ')}` })
        return
      }
    } else if (typeof payload[key] !== 'boolean') {
      sendJson(res, 400, { error: `${key} must be a boolean` })
      return
    }
    patch[key] = payload[key]
  }
  if (Object.keys(patch).length === 0) {
    sendJson(res, 400, { error: `at least one of ${SETTING_KEYS.join(', ')} must be set` })
    return
  }
  let next
  try {
    next = { ...await readSettings(), ...patch }
    await writeSettings(next)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    return
  }
  sendBody(res, false, 200, JSON.stringify(next))
}

/**
 * 读取用户级技能目录中的技能。
 * @param {any} ctx Host 插件上下文。
 * @param {any} skills 技能注册表服务。
 * @returns {Promise<{ skills: any[], complete: boolean }>} 用户技能与完整性标记。
 */
async function listUserSkills(ctx, skills) {
  const presets = ctx.get('agentPresets')
  // 没有预设注册表时无法触达用户级目录；返回空集，且不误报「来源不完整」。
  if (presets === undefined) return { skills: [], complete: true }
  let lease
  try {
    // 默认预设的只读作用域：用户级目录由该层挂载的 skill-filesystem 发现。
    lease = await presets.acquireScope()
    const snapshot = await skills.snapshot({ scope: lease.key })
    return {
      skills: snapshot.skills.filter(skill => USER_SKILL_SOURCES.has(skill.source)),
      complete: snapshot.complete,
    }
  } catch {
    // 默认预设无法挂载时仍保留全局列表，并把结果标记为不完整。
    return { skills: [], complete: false }
  } finally {
    if (lease !== undefined) {
      try {
        await lease[Symbol.asyncDispose]()
      } catch {}
    }
  }
}

/** 工作台在 DSH home 下的状态目录；未设置 `DSH_HOME` 时退回 `~/.dsh`。 */
function studioDir() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'dsh-studio')
}

/** 设置文件路径。 */
function settingsFile() {
  return join(studioDir(), 'settings.json')
}

/** 诊断日志路径：Client 半部的渲染错误逐行追加到这里。 */
function diagnosticsFile() {
  return join(studioDir(), 'diagnostics.log')
}



/**
 * 诊断端点：把 Client 半部的渲染错误追加到诊断日志，并写一条 Host 日志。
 * @param {any} ctx Host 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 */
async function handleDiagnostic(ctx, req, res) {
  if (!admitRequest(ctx, req, res)) return
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
    res.end()
    return
  }
  let payload
  try {
    payload = await readJsonBody(req, MAX_DIAGNOSTIC_BODY_BYTES)
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    return
  }
  const record = {
    at: new Date().toISOString(),
    scope: typeof payload?.scope === 'string' ? payload.scope : 'unknown',
    message: typeof payload?.message === 'string' ? payload.message : String(payload?.message ?? ''),
    ...(typeof payload?.stack === 'string' ? { stack: payload.stack } : {}),
  }
  try {
    const file = diagnosticsFile()
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    return
  }
  try {
    ctx.logger?.error?.(`dsh-studio client error [${record.scope}]: ${record.message}`)
  } catch {}
  res.writeHead(204, { 'cache-control': 'no-store' })
  res.end()
}

/**
 * 读取设置；文件缺失、损坏或字段非法时退回默认值。
 * @returns {Promise<{ pricingIndicator: boolean, balanceIndicator: boolean, balanceRefreshMs: number, themeSkin: string }>} 当前设置。
 */
async function readSettings() {
  try {
    const raw = await readFile(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    const refresh = parsed?.balanceRefreshMs
    const skin = parsed?.themeSkin
    return {
      pricingIndicator: parsed?.pricingIndicator === true,
      balanceIndicator: parsed?.balanceIndicator === true,
      balanceRefreshMs: BALANCE_REFRESH_OPTIONS.includes(refresh) ? refresh : 0,
      themeSkin: THEME_SKIN_OPTIONS.includes(skin) ? skin : 'default',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * 写入设置：先写临时文件再改名，避免半截文件。
 * @param {{ pricingIndicator: boolean, balanceIndicator: boolean, balanceRefreshMs: number, themeSkin: string }} settings 完整设置。
 */
async function writeSettings(settings) {
  const file = settingsFile()
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(settings)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * 读取并解析 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {number} limit 字节上限。
 * @returns {Promise<any>} 解析后的 JSON，空请求体为 undefined。
 */
async function readJsonBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}



/**
 * 把一个技能摘要投影为页面需要的字段。
 * @param {any} skill 技能摘要。
 * @returns {object} JSON 安全的技能条目。
 */
function toSkillEntry(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    ...(skill.path === undefined ? {} : { path: skill.path }),
    modelInvocable: skill.invocation.modelInvocable,
    userInvocable: skill.invocation.userInvocable,
  }
}

/**
 * 写一个 JSON 响应体（HEAD 只发头）。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {boolean} headOnly 是否只发头。
 * @param {number} status HTTP 状态码。
 * @param {string} body JSON 文本。
 */
function sendBody(res, headOnly, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  res.end(headOnly ? undefined : body)
}

/**
 * 发送一个 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {number} status HTTP 状态码。
 * @param {unknown} payload JSON 负载。
 */
function sendJson(res, status, payload) {
  sendBody(res, false, status, JSON.stringify(payload))
}
