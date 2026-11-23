/**
 * dsh-studio（应用内中文名「工作台」）的浏览器半部。
 *
 * 在左侧栏注册「工作台」入口（sidebar.panellist + main 面板），并在中栏渲染工作台页面。
 * 页面按两类展示技能：全局技能（Host 全局层）与用户技能（用户级技能目录）。
 * 数据来自本插件 Host 半部的只读端点 `/dsh-studio/skills`（同源 fetch，端点自带
 * DSH 连接准入），因此列表不随会话变化，也不新增模型请求、不把数据发往外部。
 */
window.__ModuleLoader__.load({
  id: 'dsh-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { Fragment, useEffect, useMemo, useRef, useState } = React;

    /** 左侧栏入口与中栏面板共用的 id，同时是 main 面板的 key。 */
    const PANEL_ID = 'studio';
    /** 本插件使用的 Client locale 命名空间。 */
    const NS = 'studio';
    /** Host 半部提供的技能只读端点。 */
    const SKILLS_ENDPOINT = '/dsh-studio/skills';
    /** Host 半部提供的设置端点（价格时段提示 / 账户余额开关）。 */
    const SETTINGS_ENDPOINT = '/dsh-studio/settings';
    /** Host 半部提供的诊断端点：渲染错误写入 Host 侧日志，便于白屏时定位。 */
    const DIAGNOSTIC_ENDPOINT = '/dsh-studio/diagnostic';
    /** 余额自动更新间隔的可选项（毫秒）；0 表示关闭。与 Host 侧校验保持一致。 */
    const BALANCE_REFRESH_OPTIONS = [0, 10000, 30000, 60000, 300000];
    /** 内置主题皮肤：default 跟随 DSH 主题，sea 为浅海晨汐，night 为深海夜航。 */
    const THEME_SKIN_OPTIONS = ['default', 'sea', 'night'];
    /**
     * 账户 Remote 需要的客户端版本号。DSH 自带客户端从构建变量读取，
     * 手写 bundle 没有该变量，这里给一个固定的语义化版本用于 x-client-version 头。
     */
    const CLIENT_VERSION = '0.1.0';

    /**
     * 高峰时段（UTC 分钟区间）：01:00–04:00 与 06:00–10:00，对应北京时间
     * 09:00–12:00、14:00–18:00。官方规则：仅周一至周五、且不含中国法定节假日。
     */
    const PEAK_WINDOWS_UTC_MINUTES = [[60, 240], [360, 600]];

    /**
     * 中国法定节假日（含调休放假日期），来源：国务院办公厅 2026、2027 年
     * 部分节假日安排通知。用于把节假日整天算作空闲时段。
     */
    const HOLIDAY_RANGES = [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07'],
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-05-01', '2027-05-05'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07'],
    ];

    /** 简体中文文案。 */
    const zh = {
      panel: '工作台',
      title: '工作台',
      intro: '全局技能与用户技能，集中在一处。',
      'nav.overview': '概览',
      'nav.interface': '个性化界面',
      'nav.skills': '技能',
      'nav.label': '工作台视图',
      'overview.skills': '技能',
      'overview.balance': '账户余额',
      'overview.hints': '左下角提示',
      'overview.off': '已关闭',
      'overview.goInterface': '打开个性化界面',
      'overview.manageSkills': '管理技能',
      'overview.loading': '读取中…',
      'overview.skillsUnit': '个技能',
      'overview.skillsEmpty': '还没有可读取的技能。',
      'overview.skillsIntro': '全局与用户技能的统一清单。',
      'overview.balanceIntro': '在左下角显示充值余额与赠送余额的合计。',
      'overview.hintsIntro': '左下角显示的两个状态。',
      'ruler.beijing': '价格时段（北京时间）',
      'ruler.now': '现在 {time}',
      'ruler.nextPeak': '距下个高峰 {duration}',
      'ruler.nextOffpeak': '{duration} 后转为空闲',
      'ruler.durationHours': '{hours} 小时 {minutes} 分',
      'ruler.durationMinutes': '{minutes} 分钟',
      'ruler.durationHoursOnly': '{hours} 小时',
      'ruler.weekend': '今天周末，全天空闲。',
      'ruler.holiday': '今天法定节假日，全天空闲。',
      'ruler.peakKey': '高峰',
      'ruler.idleKey': '空闲',
      'ruler.rule': '高峰为北京时间 09:00–12:00 与 14:00–18:00，其余时段按 5 折计费。',
      'ruler.aria': '价格刻度尺：北京时间 09:00–12:00 与 14:00–18:00 为高峰；现在是 {time}，当前{state}。',
      'interface.viewTitle': '左下角状态提示',
      'interface.viewDesc': '控制左下角（账号入口上方）显示哪些状态：价格时段提示、账户余额，以及余额的自动刷新节奏。改动会立即保存到本机设置。',
      'skills.viewTitle': '技能清单',
      'skills.viewDesc': 'DSH 宿主级插件注册的全局技能，以及用户技能目录（~/.dsh/skills、~/.agents/skills）里的技能。这里只读展示；两个分组默认收起，展开后点技能名称查看描述、适用场景与路径。',
      'skills.global.title': '全局技能',
      'skills.global.subtitle': '由 DSH 宿主级插件注册的技能，不随会话变化。',
      'skills.user.title': '用户技能',
      'skills.user.subtitle': '来自用户级技能目录（~/.dsh/skills、~/.agents/skills），不随会话变化。',
      'skills.count': '共 {count} 个技能',
      'skills.countOne': '共 {count} 个技能',
      'skills.countFiltered': '筛选中 {visible} / 共 {total} 个',
      'skills.search': '搜索技能',
      'skills.searchPlaceholder': '按名称或描述筛选',
      'skills.loading': '正在读取技能…',
      'skills.emptyGlobal': '全局层目前没有可用的技能。',
      'skills.emptyUser': '用户级技能目录里没有技能。',
      'skills.emptyFiltered': '没有匹配「{query}」的技能。',
      'skills.error': '读取技能失败：{message}',
      'skills.errorUnauthorized': '当前页面未通过 DSH 的会话认证，无法读取技能；请重新加载页面，或从 DSH 打印的地址重新打开。',
      'skills.errorUnavailable': '技能接口不可用。如果刚刚更新过插件，请刷新页面；刷新后仍不可用则需要重启 DSH。',
      'skills.errorNetwork': '无法连接 DSH 服务：{message}',
      'skills.retry': '重试',
      'skills.reloadPage': '重新加载页面',
      'skills.refresh': '刷新技能列表',
      'skills.badgeModel': '模型可调用',
      'skills.badgeUser': '用户可调用',
      'skills.whenToUse': '适用场景：',
      'skills.incomplete': '部分技能来源未能读取，列表可能不完整。',
      'skills.loaded': '已加载 {global} 个全局技能、{user} 个用户技能。',
      'skills.note': '全局技能来自宿主级插件；用户技能来自用户级技能目录。项目技能与预设私有技能不在此列。数据只在本机读取，安装或停用插件后自动刷新。',
      'status.sectionTitle': '左下角提示',
      'pricing.toggleLabel': '显示价格时段提示',
      'pricing.toggleHint': '在左下角用颜色标出当前时段。',
      'pricing.peakLabel': '高峰期',
      'pricing.idleLabel': '空闲期',
      'pricing.peakTitle': 'DeepSeek 当前为高峰时段，按标准价计价。',
      'pricing.idleTitle': 'DeepSeek 当前为空闲时段，价格是高峰价的 50%。',
      'pricing.nextSwitch': '预计 {time} 切换。',
      'pricing.rule': '规则：北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰；周末与中国法定节假日为空闲。',
      'pricing.footerLabel': 'DeepSeek 价格时段',
      'pricing.loading': '正在读取开关状态…',
      'pricing.saving': '正在保存…',
      'pricing.error': '无法读取或保存开关状态：{message}',
      'pricing.retry': '重试',
      'balance.toggleLabel': '显示账户余额',
      'balance.toggleHint': '在左下角显示账户余额（充值余额与赠送余额合计）。',
      'balance.label': '余额',
      'balance.loading': '正在读取余额…',
      'balance.unavailable': '暂不可用',
      'balance.error': '读取余额失败：{message}',
      'balance.updated': '更新于 {time}',
      'balance.current': '当前余额：{amount}',
      'balance.refresh': '刷新余额',
      'balance.autoRefresh': '自动更新',
      'balance.autoHint': '按固定间隔自动刷新；关闭时仅手动读取。',
      'theme.viewTitle': '主题',
      'theme.viewDesc': '「浅海晨汐」和「深海夜航」共用侧栏等深线，可在浅色和深色之间切换。',
      'theme.skinLabel': '主题皮肤',
      'theme.skinHint': '选择「默认」可跟随 Harness 的外观设置。',
      'theme.skinDefault': '默认（跟随 DSH）',
      'theme.skinSea': '浅海晨汐',
      'theme.skinNight': '深海夜航',
      'balance.autoOff': '关闭',
      'balance.auto10s': '10 秒',
      'balance.auto30s': '30 秒',
      'balance.auto1m': '1 分钟',
      'balance.auto5m': '5 分钟',
      'render.error': '工作台渲染出错：{message}',
      'render.reset': '关闭左下角提示并重新加载',
    };

    /** English copy; missing locales fall back through this dictionary. */
    const en = {
      panel: 'Harness Studio',
      title: 'Harness Studio',
      intro: 'Global and user skills, together in one place.',
      'nav.overview': 'Overview',
      'nav.interface': 'Personalization',
      'nav.skills': 'Skills',
      'nav.label': 'Workbench view',
      'overview.skills': 'Skills',
      'overview.balance': 'Account balance',
      'overview.hints': 'Sidebar hints',
      'overview.off': 'Off',
      'overview.goInterface': 'Open personalization',
      'overview.manageSkills': 'Manage skills',
      'overview.loading': 'Loading…',
      'overview.skillsUnit': 'skills',
      'overview.skillsEmpty': 'No skills found yet.',
      'overview.skillsIntro': 'Global and user skills in one list.',
      'overview.balanceIntro': 'Shows the top-up plus granted balance in the sidebar.',
      'overview.hintsIntro': 'The two states shown at the bottom left.',
      'ruler.beijing': 'Pricing period (Beijing time)',
      'ruler.now': 'Now {time}',
      'ruler.nextPeak': '{duration} to the next peak',
      'ruler.nextOffpeak': 'Off-peak in {duration}',
      'ruler.durationHours': '{hours} h {minutes} min',
      'ruler.durationMinutes': '{minutes} min',
      'ruler.durationHoursOnly': '{hours} h',
      'ruler.weekend': 'It is the weekend; off-peak all day.',
      'ruler.holiday': 'It is a public holiday; off-peak all day.',
      'ruler.peakKey': 'Peak',
      'ruler.idleKey': 'Off-peak',
      'ruler.rule': 'Peak is 09:00–12:00 and 14:00–18:00 Beijing time; other hours bill at half price.',
      'ruler.aria': 'Pricing scale: 09:00–12:00 and 14:00–18:00 Beijing time are peak; it is now {time}, currently {state}.',
      'interface.viewTitle': 'Bottom-left status',
      'interface.viewDesc': 'Control what the bottom-left corner (above the account row) shows: the pricing period hint, the account balance, and how often the balance refreshes. Changes save locally right away.',
      'skills.viewTitle': 'Skill list',
      'skills.viewDesc': 'Global skills registered by DSH host-level plugins, plus skills found in user-level directories (~/.dsh/skills, ~/.agents/skills). Read-only: both groups start collapsed; expand one and click a skill name to see its description, when-to-use and path.',
      'skills.global.title': 'Global skills',
      'skills.global.subtitle': 'Registered by DSH host-level plugins; independent of any session.',
      'skills.user.title': 'User skills',
      'skills.user.subtitle': 'Discovered in user-level skill directories (~/.dsh/skills, ~/.agents/skills); independent of any session.',
      'skills.count': '{count} skills',
      'skills.countOne': '{count} skill',
      'skills.countFiltered': '{visible} of {total} skills',
      'skills.search': 'Search skills',
      'skills.searchPlaceholder': 'Filter by name or description',
      'skills.loading': 'Reading skills…',
      'skills.emptyGlobal': 'The global layer has no available skills.',
      'skills.emptyUser': 'No skills in the user-level skill directories.',
      'skills.emptyFiltered': 'No skills match “{query}”.',
      'skills.error': 'Could not read skills: {message}',
      'skills.errorUnauthorized': 'This page is not authenticated with DSH, so skills cannot be read. Reload the page, or open it again from the address DSH printed.',
      'skills.errorUnavailable': 'The skills endpoint is unavailable. Reload the page if the plugin was just updated; if it persists, restart DSH.',
      'skills.errorNetwork': 'Could not reach the DSH host: {message}',
      'skills.retry': 'Retry',
      'skills.reloadPage': 'Reload page',
      'skills.refresh': 'Refresh skills',
      'skills.badgeModel': 'model-invocable',
      'skills.badgeUser': 'user-invocable',
      'skills.whenToUse': 'When to use: ',
      'skills.incomplete': 'Some skill sources could not be read, so the list may be incomplete.',
      'skills.loaded': 'Loaded {global} global skills and {user} user skills.',
      'skills.note': 'Global skills come from host-level plugins; user skills come from user-level skill directories. Project skills and preset-private skills are not listed here. The list is read locally and refreshes when plugins are installed or switched.',
      'status.sectionTitle': 'Status hints',
      'pricing.toggleLabel': 'Show the pricing indicator',
      'pricing.toggleHint': 'Color the current period at the bottom left.',
      'pricing.peakLabel': 'Peak',
      'pricing.idleLabel': 'Off-peak',
      'pricing.peakTitle': 'DeepSeek is in a peak period now, billed at the standard rate.',
      'pricing.idleTitle': 'DeepSeek is off-peak now, billed at 50% of the peak rate.',
      'pricing.nextSwitch': 'Switches around {time}.',
      'pricing.rule': 'Rule: peak is Monday–Friday 01:00–04:00 and 06:00–10:00 UTC (09:00–12:00, 14:00–18:00 Beijing); weekends and Chinese public holidays are off-peak.',
      'pricing.footerLabel': 'DeepSeek pricing period',
      'pricing.loading': 'Reading the switch state…',
      'pricing.saving': 'Saving…',
      'pricing.error': 'Could not read or save the switch: {message}',
      'pricing.retry': 'Retry',
      'balance.toggleLabel': 'Show the account balance',
      'balance.toggleHint': 'Show the account balance (top-up plus granted) at the bottom left.',
      'balance.label': 'Balance',
      'balance.loading': 'Reading balance…',
      'balance.unavailable': 'unavailable',
      'balance.error': 'Could not read the balance: {message}',
      'balance.updated': 'updated {time}',
      'balance.current': 'Current balance: {amount}',
      'balance.refresh': 'Refresh balance',
      'balance.autoRefresh': 'Auto refresh',
      'balance.autoHint': 'Refresh automatically at a fixed interval; off means manual only.',
      'theme.viewTitle': 'Theme',
      'theme.viewDesc': 'Choose Sea Tide for a light palette or Deep Sea Voyage for a dark palette. Both feature bathymetric contours in the sidebar.',
      'theme.skinLabel': 'Theme skin',
      'theme.skinHint': 'Choose Default to follow the Harness appearance setting.',
      'theme.skinDefault': 'Default (follow DSH)',
      'theme.skinSea': 'Sea Tide',
      'theme.skinNight': 'Deep Sea Voyage',
      'balance.autoOff': 'Off',
      'balance.auto10s': '10 seconds',
      'balance.auto30s': '30 seconds',
      'balance.auto1m': '1 minute',
      'balance.auto5m': '5 minutes',
      'render.error': 'Workbench failed to render: {message}',
      'render.reset': 'Turn off the status hints and reload',
    };

    /**
     * 页面样式。只引用宿主主题 token，且都带兜底值：token 改名时外观降级，
     * 但不会破坏渲染。类名统一使用 dsws- 前缀，避免与宿主样式冲突。
     */
    const CSS = `
/* 工作台：刻线仪表（概览）+ 台账（功能配置）。样式全部走主题变量，亮/暗色通用。 */
.dsws-page {
  --wb-gap: 14px;
  --wb-radius: 10px;
  --wb-rule: 0.5px solid var(--dsw-alias-border-l2);
  --wb-mono: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  container-type: inline-size;
  container-name: dsws;
}

.dsws-head {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px clamp(18px, 4vw, 44px) 0;
}

[data-platform='darwin'] .dsws-head {
  padding-top: calc(24px + var(--dsh-frame-top-clearance, 0px));
}

.dsws-headTop {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.dsws-headText {
  flex: 1 1 auto;
  min-width: 0;
}

.dsws-title {
  margin: 0;
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 1.2;
}

.dsws-intro {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

.dsws-headActions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

/* 视图切换：文字页签 + 底部刻线 */
.dsws-tabs {
  display: flex;
  gap: 22px;
  margin-top: 18px;
  border-bottom: var(--wb-rule);
}

.dsws-tab {
  appearance: none;
  margin-bottom: -0.5px;
  padding: 10px 0 9px;
  border: 0;
  border-bottom: 1.5px solid transparent;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.dsws-tab:hover {
  color: var(--dsw-alias-label-primary);
}

.dsws-tab[data-active='true'] {
  color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-label-primary);
}

.dsws-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .dsws-tab {
    transition: none;
  }
}

/* 内容滚动区 */
.dsws-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsws-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px clamp(18px, 4vw, 44px) 40px;
}

/* 窄面板：网格退成单列，并隐藏会挤在一起的可选刻度标签。 */
@container dsws (max-width: 620px) {
  .dsws-stats {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsws-rulerLabel[data-optional='true'] {
    display: none;
  }
}

/* 概览：价格刻度尺作主视觉 */
.dsws-hero {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 20px;
  border: var(--wb-rule);
  border-radius: var(--wb-radius);
  background: var(--dsw-alias-bg-layer-2);
}

.dsws-heroTop {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dsws-heroHead {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsws-heroKicker {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.dsws-heroState {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 2px 0 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.dsws-lamp {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}

.dsws-lamp[data-tone='warn'] {
  background: var(--dsw-alias-state-warn-primary);
}

.dsws-lamp[data-tone='success'] {
  background: var(--dsw-alias-state-success-primary);
}

.dsws-lamp[data-tone='brand'] {
  background: var(--dsw-alias-brand-primary);
}

.dsws-heroMeta {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}

/* 24 小时刻度尺：高峰区间 + 当前时刻 */
.dsws-ruler {
  position: relative;
  height: 56px;
  margin-top: 2px;
}

.dsws-rulerTrack {
  position: absolute;
  top: 22px;
  right: 0;
  left: 0;
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-border-l2));
}

.dsws-rulerBand {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent);
  animation: dsws-band-in 360ms ease-out both;
}

.dsws-rulerBand[data-live='false'] {
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent);
}

.dsws-rulerTicks {
  position: absolute;
  top: 30px;
  right: 0;
  left: 0;
  height: 8px;
  background-image: repeating-linear-gradient(
    to right,
    var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)) 0 0.5px,
    transparent 0.5px 4.1667%
  );
}

.dsws-rulerLabel {
  position: absolute;
  top: 40px;
  transform: translateX(-50%);
  font-family: var(--wb-mono);
  font-size: 11.5px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dsws-rulerLabel[data-edge='start'] {
  transform: none;
}

.dsws-rulerLabel[data-edge='end'] {
  transform: translateX(-100%);
}

.dsws-rulerNow {
  position: absolute;
  top: 14px;
  bottom: 10px;
  width: 1px;
  background: var(--dsw-alias-label-primary);
  transition: left 600ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.dsws-rulerNow::before {
  content: '';
  position: absolute;
  top: 4px;
  left: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
}

.dsws-rulerLegend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}

.dsws-legendKey {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dsws-swatch {
  flex: none;
  width: 10px;
  height: 6px;
  border-radius: 2px;
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-border-l2));
}

.dsws-swatch[data-tone='peak'] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent);
}

/* 周末/节假日时高峰区间是空心的，图例也要跟着变，不能只讲规则。 */
.dsws-swatch[data-tone='peak'][data-live='false'] {
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent);
}

@keyframes dsws-band-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsws-rulerNow {
    transition: none;
  }

  .dsws-rulerBand {
    animation: none;
  }
}

/* 概览三张读数卡：自动换行，新增卡片直接追加 */
.dsws-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
  gap: var(--wb-gap);
  align-items: stretch;
}

.dsws-stat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border: var(--wb-rule);
  border-radius: var(--wb-radius);
  background: var(--dsw-alias-bg-layer-2);
}

.dsws-statHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsws-statTitle {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}

.dsws-statValue {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.dsws-statValue[data-small='true'] {
  font-size: 20px;
  letter-spacing: -0.01em;
}

.dsws-statUnit {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.dsws-statRows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dsws-statRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}


.dsws-statActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 2px;
}

/* 技能占比条 */
.dsws-bar {
  display: flex;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-border-l2));
}

.dsws-barSeg {
  min-width: 0;
}

.dsws-barSeg[data-tone='global'] {
  background: var(--dsw-alias-label-secondary);
}

.dsws-barSeg[data-tone='user'] {
  background: var(--dsw-alias-label-tertiary);
}

.dsws-barLegend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.dsws-legendDot {
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 2px;
  vertical-align: 1px;
}

.dsws-legendDot[data-tone='global'] {
  background: var(--dsw-alias-label-secondary);
}

.dsws-legendDot[data-tone='user'] {
  background: var(--dsw-alias-label-tertiary);
}

/* 单列分组：个性化界面与技能页各自一块面板。 */
.dsws-groupList {
  display: flex;
  flex-direction: column;
  gap: var(--wb-gap);
}

.dsws-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 18px 20px;
  border: var(--wb-rule);
  border-radius: var(--wb-radius);
  background: var(--dsw-alias-bg-layer-2);
}

.dsws-groupHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dsws-groupTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.dsws-groupSub {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}


.dsws-groupBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 技能管理：组内小节与列表 */
.dsws-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsws-section + .dsws-section {
  border-top: var(--wb-rule);
  padding-top: 14px;
}

.dsws-sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dsws-sectionHeading {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.dsws-sectionToggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 4px 2px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.dsws-sectionToggle:hover {
  color: var(--dsw-alias-brand-primary);
}

.dsws-sectionToggle:focus-visible,
.dsws-skillToggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}

.dsws-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: -2px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 150ms ease;
}

.dsws-chevron[data-open='true'] {
  margin-top: 0;
  transform: rotate(45deg);
}

@media (prefers-reduced-motion: reduce) {
  .dsws-chevron {
    transition: none;
  }
}

.dsws-sectionTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.dsws-sectionSub {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}

.dsws-count {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dsws-toolbar {
  display: flex;
  gap: 8px;
}

.dsws-search {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  height: 34px;
  padding: 0 12px;
  border: var(--wb-rule);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}

.dsws-search::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.dsws-search:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}

.dsws-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsws-skillRow {
  border: var(--wb-rule);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-2));
}

.dsws-skillToggle {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsws-skillToggle:hover .dsws-skillName {
  color: var(--dsw-alias-brand-primary);
}

.dsws-skillName {
  font-family: var(--wb-mono);
  font-size: 12.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.dsws-skillDetails {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 12px;
}

.dsws-nameRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dsws-tag {
  padding: 3px 6px;
  border: var(--wb-rule);
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}

.dsws-tag[data-tone='user'] {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
}

.dsws-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.dsws-when {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.dsws-whenLabel {
  font-weight: 600;
}

.dsws-path {
  margin: 0;
  font-family: var(--wb-mono);
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

/* 设置行 / 开关 / 下拉 */
.dsws-settingRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.dsws-settingText {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.dsws-settingLabel {
  font-size: 13.5px;
  font-weight: 550;
}

.dsws-settingHint {
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}

.dsws-switch {
  flex: none;
  position: relative;
  width: 40px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, #d4d4d8);
  cursor: pointer;
  transition: background 150ms ease;
}

.dsws-switch[data-on='true'] {
  background: var(--dsw-alias-brand-primary);
}

.dsws-switch:disabled {
  opacity: 0.5;
  cursor: default;
}

.dsws-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}

.dsws-switchKnob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border: 0.5px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 40%, transparent);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
  transition: transform 150ms ease;
}

.dsws-switch[data-on='true'] .dsws-switchKnob {
  transform: translateX(16px);
}

/* 概览卡里的小号开关：与 12.5px 的状态行同一行高。 */
.dsws-switchSmall {
  width: 34px;
  height: 20px;
}

.dsws-switchSmall .dsws-switchKnob {
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
}

.dsws-switchSmall[data-on='true'] .dsws-switchKnob {
  transform: translateX(14px);
}

@media (prefers-reduced-motion: reduce) {
  .dsws-switch,
  .dsws-switchKnob {
    transition: none;
  }
}

.dsws-select {
  flex: none;
  height: 28px;
  padding: 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.dsws-select:disabled {
  opacity: 0.5;
  cursor: default;
}

.dsws-select:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}

.dsws-balanceRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

/* 按钮与图标按钮 */
.dsws-button {
  flex: none;
  height: 30px;
  padding: 0 12px;
  border: var(--wb-rule);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.dsws-button:hover {
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
}

.dsws-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.dsws-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}

/* 顶栏与按钮位于窗口拖拽区，交互控件必须排除，否则点击会被当成拖动。 */
.dsws-tab,
.dsws-iconButton,
.dsws-button,
.dsws-switch,
.dsws-select,
.dsws-search {
  -webkit-app-region: no-drag;
}

.dsws-iconButton {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: var(--wb-rule);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsws-iconButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
}

.dsws-iconButton:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}

.dsws-iconButton[data-busy='true'] svg {
  animation: dsws-spin 900ms linear infinite;
}

@keyframes dsws-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsws-iconButton[data-busy='true'] svg {
    animation: none;
  }
}

/* 状态与空态 */
.dsws-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

.dsws-warn {
  margin: 0;
  padding-left: 8px;
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary);
}

.dsws-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}

.dsws-errorText {
  flex: 1 1 200px;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary);
}

.dsws-empty {
  padding: 16px;
  border: 0.5px dashed var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  border-radius: 8px;
  text-align: center;
}

.dsws-emptyText {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}

.dsws-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: var(--wb-rule);
  border-radius: 8px;
}

.dsws-skeletonBar {
  height: 10px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
  animation: dsws-pulse 1.4s ease-in-out infinite;
}

.dsws-skeletonBar[data-width='name'] {
  width: 38%;
}

.dsws-skeletonBar[data-width='desc'] {
  width: 88%;
}

.dsws-skeletonBar[data-width='path'] {
  width: 55%;
}

@keyframes dsws-pulse {
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsws-skeletonBar {
    animation: none;
  }
}

.dsws-srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

`;

    /**
     * 左下角状态提示的样式。它独立于页面样式：提示挂在侧栏底部，
     * 即使工作台页面没有打开也必须能正确渲染。两行标记（价格时段、账户余额）
     * 由同一个组件纵向排列，所以外层容器负责整体间距。
     */
    const BADGE_CSS = `
.dsws-foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin: 0 0 6px;
}

.dsws-foot[data-wide='false'] {
  width: auto;
  align-items: center;
}

.dsws-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  flex: none;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  cursor: default;
  -webkit-app-region: no-drag;
}

.dsws-badge:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}

.dsws-badgeWide {
  width: 100%;
  height: 28px;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 12px;
}

/* 文字保持主文字色（保证对比度），状态只由圆点承担。 */
.dsws-badgeLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.dsws-badgeAmount {
  font-variant-numeric: tabular-nums;
}

/* 状态圆点：价格时段用琥珀/绿，余额用品牌蓝，不可用退到次级色。 */
.dsws-badgeDot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent);
}

.dsws-badge[data-period='peak'] .dsws-badgeDot {
  background: var(--dsw-alias-state-warn-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
}

.dsws-badge[data-tone='balance'] .dsws-badgeDot {
  background: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
}

.dsws-badge[data-state='muted'] .dsws-badgeDot {
  background: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  box-shadow: none;
}

.dsws-badgeSrOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

    /**
     * 左侧栏「工作台」图标：与插件图标（icon.svg）同一套几何——
     * 两块灰色矩形（导航列与内容区）加右上角一块橙色旋转方片。
     * 颜色固定为图标本身的配色，不随侧栏选中状态变化。
     * @param {{ size?: number }} props 宿主传入的边长（展开 16、收起 18）。
     */
    function WorkstationIcon({ size }) {
      const edge = typeof size === 'number' ? size : 16;
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: 'false',
        },
        h(
          'g',
          { fill: '#78768E' },
          h('rect', { x: 2, y: 3, width: 7.5, height: 19, rx: 1.75 }),
          h('rect', { x: 11.5, y: 14, width: 10, height: 8, rx: 1.75 }),
        ),
        h('rect', {
          x: 12,
          y: 2,
          width: 9.5,
          height: 9.5,
          rx: 2,
          fill: '#E37825',
          transform: 'rotate(-10 16.75 6.75)',
        }),
      );
    }

    /** 刷新按钮的小图标（两个圆弧 + 箭头）。 */
    function RefreshGlyph() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M19.4 12a7.4 7.4 0 1 1-2.17-5.23',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M19.4 4.6V8.5H15.5',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /**
     * 上报一次客户端渲染错误（尽力而为，失败静默）。
     * @param {string} scope 出错区块（main / footer / window-error 等）。
     * @param {unknown} error 错误对象。
     */
    function reportClientError(scope, error) {
      try {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined;
        void fetch(DIAGNOSTIC_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope, message, ...(stack === undefined ? {} : { stack }) }),
        }).catch(() => {});
      } catch {}
    }

    /**
     * 给面板组件加一层渲染兜底：出错时显示错误并上报，而不是让 slot 直接白屏。
     * @param {string} scope 上报用的区块名。
     * @param {Function} Inner 真正的组件。
     * @param {{ compact?: boolean, onReset?: Function }} [options] 紧凑展示与「关闭提示并重载」回调。
     * @returns {Function} 包了一层错误边界的组件。
     */
    function withRenderBoundary(scope, Inner, options = {}) {
      const ComponentBase = React.Component;
      // 运行时若不提供 React.Component，就退化为直接渲染，避免整块功能不可用。
      if (typeof ComponentBase !== 'function') return Inner;
      class StudioBoundary extends ComponentBase {
        constructor(props) {
          super(props);
          this.state = { error: undefined };
        }
        static getDerivedStateFromError(error) {
          return { error };
        }
        componentDidCatch(error) {
          reportClientError(scope, error);
        }
        render() {
          if (this.state.error !== undefined) {
            const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
            const translate = this.props.translate;
            const text = typeof translate === 'function' ? translate('render.error', { message }) : `dsh-studio: ${message}`;
            if (options.compact === true) {
              // 侧栏底部空间有限：只留一个带完整错误提示的小标记。
              return h('span', { className: 'dsws-badge', title: text, 'aria-label': text, role: 'img' }, '⚠');
            }
            return h(
              'div',
              { className: 'dsws-error', role: 'alert', style: { margin: '12px', fontSize: '12.5px', lineHeight: '1.6' } },
              h('p', { className: 'dsws-errorText' }, text),
              typeof options.onReset === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsws-button',
                      onClick: () => { void options.onReset(); },
                    },
                    typeof translate === 'function' ? translate('render.reset') : 'Reset',
                  )
                : null,
            );
          }
          return this.props.children;
        }
      }
      return function BoundaryWrapper(props) {
        return h(StudioBoundary, { translate: props.t }, h(Inner, props));
      };
    }

    /**
     * 把一次失败归为页面可翻译的错误码。
     * @param {unknown} error 抛出的错误。
     * @returns {{ code: string, detail?: string }} 错误码与可选细节。
     */
    function classifyFailure(error) {
      if (error && typeof error === 'object' && typeof error.code === 'string') {
        return { code: error.code, detail: typeof error.detail === 'string' ? error.detail : undefined };
      }
      return { code: 'network', detail: error instanceof Error ? error.message : String(error) };
    }

    /** 带错误码的读取失败，便于渲染时按语言翻译。 */
    class SkillFetchError extends Error {
      constructor(code, detail) {
        super(detail === undefined ? code : `${code}: ${detail}`);
        this.name = 'SkillFetchError';
        this.code = code;
        this.detail = detail;
      }
    }

    /**
     * 读取 Host 半部的技能端点。
     * @param {AbortSignal} signal 取消信号。
     * @returns {Promise<{ global: object[], user: object[], complete: boolean }>} 两类技能与完整性标记。
     */
    async function fetchSkills(signal) {
      let response;
      try {
        response = await fetch(SKILLS_ENDPOINT, {
          method: 'GET',
          signal,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new SkillFetchError('network', error instanceof Error ? error.message : String(error));
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new SkillFetchError('unauthorized');
        // 404/405：端点未挂载；503：Host 侧连接或技能服务不可用。两者都按「不可用」给出重载指引。
        if (response.status === 404 || response.status === 405 || response.status === 503) {
          throw new SkillFetchError('unavailable');
        }
        // 其余状态尽量把 Host 的错误体带到页面，避免只剩一个裸状态码。
        let detail = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          if (payload && typeof payload.error === 'string' && payload.error !== '') detail = payload.error;
        } catch {}
        throw new SkillFetchError('http', detail);
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        // 回退到页面 HTML 时说明端点没有挂载。
        throw new SkillFetchError('unavailable');
      }
      return {
        global: payload && Array.isArray(payload.global) ? payload.global : [],
        user: payload && Array.isArray(payload.user) ? payload.user : [],
        complete: !payload || payload.complete !== false,
      };
    }

    /** 技能条目上的调用方式徽标。 */
    function skillBadges(skill, t) {
      const badges = [];
      if (skill.modelInvocable === true) {
        badges.push(h('span', { className: 'dsws-tag', key: 'model' }, t('skills.badgeModel')));
      }
      if (skill.userInvocable === true) {
        badges.push(h('span', { className: 'dsws-tag', key: 'user', 'data-tone': 'user' }, t('skills.badgeUser')));
      }
      return badges;
    }

    /** 把 'YYYY-MM-DD' 日期区间展开成日期集合。 */
    function expandHolidayRanges(ranges) {
      const days = new Set();
      for (const [start, end] of ranges) {
        const cursor = new Date(`${start}T00:00:00Z`);
        const last = new Date(`${end}T00:00:00Z`);
        while (cursor.getTime() <= last.getTime()) {
          days.add(cursor.toISOString().slice(0, 10));
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      return days;
    }

    /** 中国法定节假日日期集合（2026–2027）。 */
    const HOLIDAYS = expandHolidayRanges(HOLIDAY_RANGES);

    /**
     * 计算某一时刻的价格时段。
     * 高峰：北京时间周一至周五 09:00–12:00、14:00–18:00（UTC 01:00–04:00、
     * 06:00–10:00），且当天不是中国法定节假日；其余时间为空闲时段。
     * @param {number} milliseconds 时间戳。
     * @returns {'peak'|'offpeak'} 高峰或空闲。
     */
    function pricingPeriodAt(milliseconds) {
      const now = new Date(milliseconds);
      const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      // 工作日与节假日按北京时间（UTC+8）判定；高峰窗口按官方定义的 UTC 时间判定。
      const beijing = new Date(milliseconds + 8 * 60 * 60 * 1000);
      const weekday = beijing.getUTCDay() >= 1 && beijing.getUTCDay() <= 5;
      const holiday = HOLIDAYS.has(beijing.toISOString().slice(0, 10));
      const inPeakWindow = PEAK_WINDOWS_UTC_MINUTES
        .some(([start, end]) => utcMinutes >= start && utcMinutes < end);
      return weekday && inPeakWindow && !holiday ? 'peak' : 'offpeak';
    }

    /**
     * 下一个时段切换时刻（毫秒）。逐分钟向后查找，最多 8 天。
     * @param {number} milliseconds 时间戳。
     * @returns {number} 切换时刻。
     */
    function nextPricingSwitchAt(milliseconds) {
      const minute = 60 * 1000;
      const start = Math.floor(milliseconds / minute) * minute;
      const current = pricingPeriodAt(milliseconds);
      for (let offset = 1; offset <= 8 * 24 * 60; offset += 1) {
        const candidate = start + offset * minute;
        if (pricingPeriodAt(candidate) !== current) return candidate;
      }
      return start + minute;
    }

    /**
     * 按浏览器时区格式化切换时刻。
     * @param {number} milliseconds 时间戳。
     * @returns {string} 本地化的「月/日 时:分」。
     */
    function formatSwitchTime(milliseconds) {
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(milliseconds));
      } catch {
        return new Date(milliseconds).toLocaleString();
      }
    }

    /**
     * 按北京时间格式化「时:分」。价格刻度尺按北京时间解释，必须用它，
     * 否则其他时区的用户会看到「现在 02:00」而光标落在 09–12 区间。
     * @param {number} milliseconds 时间戳。
     * @returns {string} 北京时间的时:分。
     */
    function formatBeijingClock(milliseconds) {
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Shanghai',
        }).format(new Date(milliseconds));
      } catch {
        const date = new Date(milliseconds + 8 * 60 * 60 * 1000);
        return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
      }
    }

    /** 极简可订阅状态：页面开关与左下角提示共用同一份设置。 */
    function useStoreValue(store) {
      const [value, setValue] = useState(store.get());
      useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
      return value;
    }

    /**
     * 每 30 秒重算一次价格时段，跨过时段边界后自动更新。
     * @param {boolean} active 提示是否已开启。
     * @returns {{ period: 'peak'|'offpeak', nextSwitchAt: number, now: number }} 当前时段、切换时刻与采样时间。
     */
    function usePricing(active) {
      const [now, setNow] = useState(Date.now());
      useEffect(() => {
        if (!active) return undefined;
        const tick = () => setNow(Date.now());
        tick();
        const timer = window.setInterval(tick, 30000);
        return () => {
          window.clearInterval(timer);
        };
      }, [active]);
      return useMemo(
        () => ({ period: pricingPeriodAt(now), nextSwitchAt: nextPricingSwitchAt(now), now }),
        [now],
      );
    }

    /**
     * 工作台设置存储：一次 GET 读取，PUT 局部写回；乐观更新，失败回滚。
     * 状态保存在 Host 侧（$DSH_HOME/dsh-studio/settings.json），刷新与重启后保留。
     */
    function createSettingsStore() {
      let state = {
        status: 'idle',
        pricingIndicator: false,
        balanceIndicator: false,
        balanceRefreshMs: 0,
        themeSkin: 'default',
        saving: false,
        error: undefined,
      };
      const listeners = new Set();
      let inflight;
      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {}
        }
      };
      const patch = (next) => {
        state = { ...state, ...next };
        emit();
      };
      /** 把 Host 返回的完整设置投影到本地状态。 */
      const applyPayload = (payload) => {
        const source = payload !== null && typeof payload === 'object' ? payload : {};
        return {
          pricingIndicator: source.pricingIndicator === true,
          balanceIndicator: source.balanceIndicator === true,
          balanceRefreshMs: BALANCE_REFRESH_OPTIONS.includes(source.balanceRefreshMs)
            ? source.balanceRefreshMs
            : 0,
          themeSkin: THEME_SKIN_OPTIONS.includes(source.themeSkin) ? source.themeSkin : 'default',
        };
      };
      const load = () => {
        if (inflight !== undefined) return inflight;
        patch({ status: 'loading', error: undefined });
        inflight = (async () => {
          try {
            const response = await fetch(SETTINGS_ENDPOINT, {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            patch({ status: 'ready', ...applyPayload(await response.json()), saving: false, error: undefined });
          } catch (error) {
            patch({
              status: 'error',
              saving: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            inflight = undefined;
          }
        })();
        return inflight;
      };
      /**
       * 写入一个开关；PUT 只带这个键，其他开关保持 Host 侧的原值。
       * @param {'pricingIndicator'|'balanceIndicator'} key 开关名。
       * @param {boolean} value 新值。
       */
      const setSetting = async (key, value) => {
        const previous = state[key];
        patch({ [key]: value, saving: true, error: undefined });
        try {
          const response = await fetch(SETTINGS_ENDPOINT, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ [key]: value }),
          });
          if (!response.ok) {
            let detail = `HTTP ${response.status}`;
            try {
              const payload = await response.json();
              if (payload !== null && typeof payload === 'object' && typeof payload.error === 'string') detail = payload.error;
            } catch {}
            throw new Error(detail);
          }
          patch({ status: 'ready', ...applyPayload(await response.json()), saving: false, error: undefined });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          patch({ [key]: previous, saving: false, error: message });
          // 设置保存失败也写一份诊断日志，便于排查 Host 校验或连接问题。
          reportClientError(`settings-save:${key}`, error);
        }
      };
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        load,
        setSetting,
      };
    }

    /** 账户余额的十进制文本语法（Platform 返回的金额字符串，可能带指数）。 */
    const BALANCE_DECIMAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

    /**
     * 币种符号。
     * @param {string} currency 币种代码。
     * @returns {string} 符号；未知币种返回空串。
     */
    function currencySymbol(currency) {
      if (currency === 'CNY') return '¥';
      if (currency === 'USD') return '$';
      return '';
    }

    /** 给整数位加千分位分隔符。 */
    function groupDigits(value) {
      const trimmed = value.replace(/^0+(?=\d)/, '');
      return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** 非负整数位加一（用于负数四舍五入进位）。 */
    function incrementDigits(value) {
      let carry = 1;
      const out = [];
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const digit = value.charCodeAt(index) - 48 + carry;
        out.unshift(String(digit % 10));
        carry = digit > 9 ? 1 : 0;
      }
      if (carry === 1) out.unshift('1');
      return out.join('');
    }

    /**
     * 按 Platform 网页端的显示规则格式化金额：两位小数、千分位、正数截断到分、
     * 不足一分显示 `<¥0.01`、负数四舍五入且最小 0.01。
     * 直接在十进制文本上计算，避免浮点误差。
     * @param {string} amount 十进制金额文本。
     * @param {string} symbol 币种符号。
     * @returns {string} 展示文本；格式非法时为 —。
     */
    function formatBalanceAmount(amount, symbol) {
      const text = typeof amount === 'string' ? amount.trim() : String(amount);
      if (!BALANCE_DECIMAL.test(text)) return '—';
      const negative = text.startsWith('-');
      const body = negative || text.startsWith('+') ? text.slice(1) : text;
      const [mantissa, exponentText] = body.toLowerCase().split('e');
      const exponent = exponentText === undefined ? 0 : Number(exponentText);
      const point = mantissa.indexOf('.');
      const integerPart = point === -1 ? mantissa : mantissa.slice(0, point);
      const fractionPart = point === -1 ? '' : mantissa.slice(point + 1);
      const digits = `${integerPart}${fractionPart}`;
      const pointIndex = integerPart.length + exponent;
      let integer;
      let fraction;
      if (pointIndex <= 0) {
        integer = '0';
        fraction = `${'0'.repeat(-pointIndex)}${digits}`;
      } else if (pointIndex >= digits.length) {
        integer = `${digits}${'0'.repeat(pointIndex - digits.length)}`;
        fraction = '';
      } else {
        integer = digits.slice(0, pointIndex);
        fraction = digits.slice(pointIndex);
      }
      const cents = `${fraction}00`.slice(0, 2);
      const isZeroRun = (value) => /^0*$/.test(value);
      if (!negative) {
        // 正数截断到分，绝不向上取整。
        if (isZeroRun(integer) && isZeroRun(fraction)) return `${symbol}0.00`;
        if (isZeroRun(integer) && isZeroRun(cents)) return `<${symbol}0.01`;
        return `${symbol}${groupDigits(integer)}.${cents}`;
      }
      // 负数按第三位小数四舍五入，最小显示 0.01。
      const rest = fraction.slice(2);
      let rounded = Number(cents);
      let carry = false;
      if (rest !== '' && rest.charCodeAt(0) >= 53) {
        rounded += 1;
        if (rounded > 99) {
          rounded = 0;
          carry = true;
        }
      }
      const integerRaw = carry ? incrementDigits(integer) : integer.replace(/^0+(?=\d)/, '');
      const centText = String(rounded).padStart(2, '0');
      if (integerRaw === '0' && centText === '00') return `-${symbol}0.01`;
      return `-${symbol}${groupDigits(integerRaw)}.${centText}`;
    }

    /**
     * 把充值余额与赠送余额按币种合计，返回展示文本；多币种用 / 分隔。
     * @param {any[]} wallets 充值余额钱包。
     * @param {any[]} bonusWallets 赠送余额钱包。
     * @returns {string} 展示文本。
     */
    function formatBalanceTotal(wallets, bonusWallets) {
      try {
        const totals = new Map();
        const add = (list) => {
          if (!Array.isArray(list)) return;
          for (const wallet of list) {
            if (wallet === null || typeof wallet !== 'object') continue;
            const value = Number(wallet.balance);
            if (!Number.isFinite(value)) continue;
            const currency = typeof wallet.currency === 'string' ? wallet.currency : '';
            totals.set(currency, (totals.get(currency) ?? 0) + value);
          }
        };
        add(wallets);
        add(bonusWallets);
        // 没有钱包数据时按零余额显示，避免把「零余额」误报为不可用。
        if (totals.size === 0) return `${currencySymbol('CNY')}0.00`;
        return [...totals]
          .sort(([left], [right]) => String(left).localeCompare(String(right)))
          .map(([currency, total]) => formatBalanceAmount(String(total), currencySymbol(currency)))
          .join(' / ');
      } catch {
        // 金额格式异常不应拖垮整个面板。
        return '—';
      }
    }

    /**
     * 账户余额存储：通过 DSH 账户自身的 Remote（`remote.account` 服务）读取。
     * 不接触任何密钥、不轮询；余额只留在内存里，不写入设置文件。
     * @param {any} ctx Client 根上下文。
     * @param {{ current: any }} accountRef 可选注入的账户 Remote 命名空间引用。
     */
    function createBalanceStore(ctx, accountRef) {
      let state = { status: 'idle', wallets: [], bonusWallets: [], updatedAt: undefined, error: undefined };
      const listeners = new Set();
      let inflight;
      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {}
        }
      };
      const patch = (next) => {
        state = { ...state, ...next };
        emit();
      };
      const load = () => {
        if (inflight !== undefined) return inflight;
        try {
          // 只在 `remote.account` 服务就绪后使用它；未注入时视为不可用。
          const account = accountRef.current;
          // 没有账户 Remote 的配置（例如非 DeepSeek 账户部署）直接标记为不可用。
          if (account === undefined || account === null || typeof account.getBalance !== 'function') {
            patch({ status: 'unavailable', error: undefined });
            return Promise.resolve();
          }
          patch({ status: 'loading', error: undefined });
          inflight = (async () => {
            try {
              const snapshot = ctx.locale.getSnapshot();
              const result = await account.getBalance({
                version: CLIENT_VERSION,
                locale: snapshot.active,
                // Date.getTimezoneOffset 是「UTC 以西的分钟数」，账户接口要 UTC 以东的秒数。
                timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
              });
              if (result === null || typeof result !== 'object' || result.ok !== true) {
                const message = result !== null && typeof result === 'object'
                  && result.error !== null && typeof result.error === 'object'
                  && typeof result.error.message === 'string'
                  ? result.error.message
                  : 'account balance failed';
                throw new Error(message);
              }
              const balance = result.value;
              if (balance === null || typeof balance !== 'object' || balance.status !== 'ready') {
                // 未登录或账户接口拒绝时保持「不可用」，不把余额当成 0。
                patch({ status: 'unavailable', wallets: [], bonusWallets: [], updatedAt: undefined, error: undefined });
                return;
              }
              patch({
                status: 'ready',
                wallets: Array.isArray(balance.value) ? balance.value : [],
                bonusWallets: Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [],
                updatedAt: Date.now(),
                error: undefined,
              });
            } catch (error) {
              patch({ status: 'error', error: error instanceof Error ? error.message : String(error) });
            } finally {
              inflight = undefined;
            }
          })();
          return inflight;
        } catch (error) {
          // 访问账户 Remote 本身失败时也不能让调用方（effect）崩溃。
          inflight = undefined;
          patch({ status: 'error', error: error instanceof Error ? error.message : String(error) });
          return Promise.resolve();
        }
      };
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        load,
        /** 账户 Remote 晚于插件就绪时调用：把「不可用」重置为待读取，让页面/角标重新触发读取。 */
        attachAccount() {
          if (state.status === 'unavailable' || state.status === 'idle') patch({ status: 'idle', error: undefined });
        },
      };
    }

    /** 主题皮肤样式元素与根标记（页面里只保留一份）。 */
    const SKIN_STYLE_ID = 'dsh-studio-skin-style';
    const SKIN_ATTR = 'data-dsh-studio-skin';
    /** 宿主自身的外观是否为深色：皮肤切换时据此恢复或覆盖。 */
    let hostColorSchemeDark = false;
    /**
     * 让 body 的深色标记与当前皮肤一致：
     * - 深海夜航：确保有标记，宿主/第三方插件走深色分支；
     * - 浅海晨汐：确保没有标记，避免宿主深色样式渗进浅色皮肤；
     * - 默认：恢复宿主自己的状态。
     */
    function syncHostDarkMarker(skin) {
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return;
      const body = document.body;
      const wantDark = skin === 'night' ? true : skin === 'sea' ? false : hostColorSchemeDark;
      if (wantDark && !body.hasAttribute('data-ds-dark-theme')) body.setAttribute('data-ds-dark-theme', '');
      else if (!wantDark && body.hasAttribute('data-ds-dark-theme')) body.removeAttribute('data-ds-dark-theme');
    }

    // 经宿主资源映射加载同包 SVG，桌面端和浏览器均使用同一幅等深线图。
    const seaContourUrl = require.asset('plugins/dsh-studio/assets/sea-contours-f3ab83f1dbe3.svg');

    /** 样式限定在皮肤标记下，切换回默认主题时随样式节点一起移除。 */
    function builtInSkinCss() {
      return `
html[data-dsh-studio-skin='sea'],
html[data-dsh-studio-skin='sea'] body {
  color-scheme: light;
  background-color: #fafcfb !important;
  --dsw-alias-bg-base: #fafcfb !important;
  --dsw-alias-bg-layer-1: #fefefe !important;
  --dsw-alias-bg-layer-2: #f0f6f6 !important;
  --dsw-alias-bg-layer-3: #e1efef !important;
  --dsw-alias-bg-overlay: #ffffff !important;
  --dsw-alias-markdown-code-block: #eef4f5 !important;
  --dsw-alias-markdown-code-block-banner: #eef4f5 !important;
  --dsw-specific-input-major: #fefefe !important;
  --dsw-specific-sidebar-fill: #e4f2f1 !important;
  --dsw-alias-button-elevated-fill: #fcfdfc !important;
  --dsw-specific-sidebar-glass-fill: #fcfdfc !important;
  --dsw-specific-sidebar-glass-hover: #d2edeb !important;
  --dsw-specific-sidebar-glass-collapsed-fill: #e4f2f1 !important;
  --dsw-specific-sidebar-glass-collapsed-hover: #d2edeb !important;
  --dsw-alias-brand-primary: #006f78 !important;
  --dsw-alias-state-business-primary: #006f78 !important;
  --dsw-alias-button-info-fill: #006f78 !important;
  --dsw-alias-button-info-hover: #00636b !important;
  --dsw-alias-label-on-color: #ffffff !important;
  --dsw-alias-label-primary: #19323d !important;
  --dsw-alias-label-secondary: #506776 !important;
  --dsw-alias-label-tertiary: #526e7e !important;
  --dsw-alias-label-caption: #526e7e !important;
  --dsw-alias-label-quaternary: #829ba4 !important;
  --dsw-alias-border-l1: #e1eded !important;
  --dsw-alias-border-l2: #cfdee2 !important;
  --dsw-alias-border-l3: #c4d8dc !important;
  --dsw-alias-border-l4: #b9cfd4 !important;
  --dsw-alias-interactive-bg-hover: #d2edeb !important;
  --dsw-alias-interactive-bg-hover-solid: #d2edeb !important;
  --dsw-alias-interactive-bg-active: #cbe6e3 !important;
  --dsw-alias-state-idle-primary: #657f8b !important;
  --dsw-alias-state-success-primary: #07994c !important;
  --dsw-alias-state-warn-primary: #a46b20 !important;
  --dsw-alias-state-error-primary: #b84a4a !important;
}

/* 深海夜航使用独立的颜色标记，不写入宿主外观偏好。菜单、弹窗和右栏共用层级色。 */
html[data-dsh-studio-skin='night'],
html[data-dsh-studio-skin='night'] body {
  color-scheme: dark;
  color: #e7eff6;
  background-color: #0e1723 !important;
  --dsw-alias-bg-base: #0e1723 !important;
  --dsw-alias-bg-layer-1: #111f2d !important;
  --dsw-alias-bg-layer-2: #172939 !important;
  --dsw-alias-bg-layer-3: #203849 !important;
  --dsw-alias-bg-overlay: #192d3e !important;
  --dsw-alias-bg-module-platform: #111f2d !important;
  --dsw-alias-bg-multi-select: #203c51 !important;
  --dsw-alias-card-fill: #152635 !important;
  --dsw-alias-card-fill-hover: #1c3346 !important;
  --dsw-alias-card-tile-fill: #1a2e40 !important;
  --dsw-specific-menu: #172939 !important;

  /* 宿主把菜单/浮层底面拆成独立 token，深色外观下才切换；深色皮肤需要一并覆盖。 */
  --dsw-menu-surface-fill: rgb(23 41 57 / 82%) !important;
  --dsw-alias-menu-group-header-fill: rgb(23 41 57 / 94%) !important;
  --dsw-alias-bg-mask-1: rgb(0 0 0 / 50%) !important;
  --dsw-alias-bg-mask-2: rgb(0 0 0 / 20%) !important;
  --dsw-alias-bg-mask-3: rgb(0 0 0 / 48%) !important;
  --dsw-alias-bg-mask-drop: rgb(39 39 48 / 70%) !important;
  --dsw-alias-toast-bg: #1b3143 !important;
  --dsw-alias-toast-label: #e7eff6 !important;
  --dsw-alias-toast-action: #74c5ff !important;
  --dsw-alias-tooltip-bg: #1f3749 !important;
  --dsw-alias-tooltip-label: #e7eff6 !important;
  --dsw-alias-tooltip-key-bg: #31506a !important;
  --dsw-alias-label-primary-dimmed: #a9c0cf !important;
  --dsw-specific-selector: #162838 !important;
  --dsw-specific-input-major: #172634 !important;
  --dsw-specific-login-input: #172634 !important;
  --dsw-specific-bubble: #1b3449 !important;
  --dsw-specific-bubble-highlight: #24465d !important;
  --dsw-alias-markdown-code-block: #172939 !important;
  --dsw-alias-markdown-code-block-banner: #172939 !important;
  --dsw-alias-markdown-inline-code: #1a2a39 !important;
  --dsw-alias-label-primary: #e7eff6 !important;
  --dsw-alias-label-primary-bluish: #d7e7f2 !important;
  --dsw-alias-label-secondary: #b3c7d6 !important;
  --dsw-alias-label-tertiary: #96b0c3 !important;
  --dsw-alias-label-caption: #9db4c6 !important;
  --dsw-alias-label-dimmed: #829bac !important;
  --dsw-alias-label-primary-inverted: #0c1e2e !important;
  --dsw-alias-label-on-color: #fff !important;
  --dsw-alias-label-primary-foreground: #102332 !important;
  --dsw-alias-hovercard-bg: #192d3e !important;
  --dsw-alias-hovercard-label-primary: #e7eff6 !important;
  --dsw-alias-hovercard-label-secondary: #b3c7d6 !important;
  --dsw-alias-hovercard-label-tertiary: #96b0c3 !important;
  --dsw-alias-menu-icon: #b3c7d6 !important;
  --dsw-alias-border-l1: #203241 !important;
  --dsw-alias-border-l2: #304858 !important;
  --dsw-alias-border-l2-darkmode-thin: #304858 !important;
  --dsw-alias-border-l3: #395568 !important;
  --dsw-alias-border-l4: #48687e !important;
  --dsw-alias-interactive-bg-hover: #193246 !important;
  --dsw-alias-interactive-bg-hover-solid: #193246 !important;
  --dsw-alias-interactive-bg-active: #203c51 !important;
  --dsw-alias-brand-text: #deebf5 !important;
  --dsw-alias-brand-primary: #44d6e3 !important;
  --dsw-alias-state-business-primary: #44d6e3 !important;
  --dsw-alias-link: #74c5ff !important;
  --dsw-alias-button-info-fill: #3377fb !important;
  --dsw-alias-button-info-hover: #4388ff !important;
  --dsw-alias-button-elevated-fill: #102333 !important;
  --dsw-alias-button-floating-fill: #1d3244 !important;
  --dsw-alias-button-floating-hover: #284659 !important;
  --dsw-alias-button-primary-fill: #d6e6ef !important;
  --dsw-alias-button-primary-hover: #edf6fa !important;
  --dsw-alias-button-tool-bar-fill: #1a3042 !important;
  --dsw-alias-button-tool-bar-hover: #264255 !important;
  --dsw-alias-state-success-primary: #42cd82 !important;
  --dsw-alias-state-warn-primary: #e6b262 !important;
  --dsw-alias-state-error-primary: #ff9498 !important;
  --dsw-specific-sidebar-fill: #0c1e2e !important;
  --dsw-specific-sidebar-glass-fill: #102333 !important;
  --dsw-specific-sidebar-glass-hover: #193246 !important;
  --dsw-specific-sidebar-glass-collapsed-fill: #0c1e2e !important;
  --dsw-specific-sidebar-glass-collapsed-hover: #193246 !important;
  --dsw-alias-scrollbar-bg-l2: #385164 !important;
  --dsw-alias-scrollbar-hover-l2: #58758b !important;
  --shiki-token-constant: #60bcff;
  --shiki-token-string: #8cdd9b;
  --shiki-token-comment: #94acbf;
  --shiki-token-keyword: #ff9aba;
  --shiki-token-parameter: #ffbd7d;
  --shiki-token-function: #c8a9ff;
  --shiki-token-string-expression: #a9e4ac;
  --shiki-token-punctuation: #c7d7e3;
  --shiki-token-link: #74c5ff;
}

@media (forced-colors: none) {
  /* 给预览中的侧栏地形换成暗部青光，复用同一张透明图的轮廓。 */
  html[data-dsh-studio-skin='night'] [class*='_root']:has(> [class*='_logoRow'][data-window-drag]) {
    background: linear-gradient(rgb(12 30 46 / 60%), rgb(12 30 46 / 60%)),
      url("${seaContourUrl}") left bottom / 100% min(40.5%, 370px) no-repeat, #0c1e2e !important;
  }

  html[data-dsh-studio-skin='night'] [data-phase] [data-slot='conversation.header'] > header {
    background-image: radial-gradient(ellipse at 95% 0%, #0b3451, transparent 65%);
  }

  html[data-dsh-studio-skin='night'] [data-composer-card] {
    --dsw-elevation-stroke-color: #41657b;
  }

  html[data-dsh-studio-skin='night'] [data-composer-card] button[class*='_primary'][aria-busy] {
    background: linear-gradient(155deg, #5397ff 0%, #3377fb 55%, #205ece);
    box-shadow: inset 0 1px 1px rgb(203 228 255 / 48%), 0 1px 3px #07121d;
  }
}

/* 外层列负责分隔线，Windows 的侧栏内容根节点会另绘一层不透明底色。 */
html[data-dsh-studio-skin='sea'] [class*='sidebarCol'] {
  border-right-color: #d3e6e6 !important;
}

/* 用直属品牌行识别可见侧栏表面，直接在该表面绘制等深线，兼容插槽包装层。 */
html[data-dsh-studio-skin='sea'] [class*='_root']:has(> [class*='_logoRow'][data-window-drag]) {
  background-color: var(--dsw-specific-sidebar-fill) !important;
  background-image: url("${seaContourUrl}") !important;
  background-size: 100% min(40.5%, 370px) !important;
  background-position: left bottom !important;
  background-repeat: no-repeat !important;
}

/* 宿主用纯色渐变遮住列表底端；只淡出滚动内容，让背后的等深线保持连续。 */
html[data-dsh-studio-skin] [data-sidebar-scrollport] {
  mask-image: linear-gradient(to bottom, black calc(100% - 24px), transparent);
}

html[data-dsh-studio-skin] [data-sidebar-scrollport] ~ [class*='_scrollFade'] {
  background: none !important;
}

/* 宿主的会话树用 aria-selected 标记当前行，搜索结果沿用同一语义。 */
html[data-dsh-studio-skin] [class*='sidebarCol'] [role='treeitem'][aria-selected='true'],
html[data-dsh-studio-skin] [class*='sidebarCol'] [aria-current='page'],
html[data-dsh-studio-skin] [class*='sidebarCol'] [data-active='true'],
html[data-dsh-studio-skin] [class*='sidebarCol'] [data-selected='true'] {
  background-color: var(--dsw-alias-interactive-bg-active) !important;
}

/* 预览图中余额使用深墨色，空闲时段保留绿色。 */
html[data-dsh-studio-skin] .dsws-badge[data-tone='balance']:not([data-state='muted']) .dsws-badgeDot {
  background: var(--dsw-alias-label-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
}

/* 只处理输入卡片的主操作。用内侧亮边和下沿暗部塑形，保留宿主的图标与发送中状态。 */
@media (forced-colors: none) {
  html[data-dsh-studio-skin='sea'] [data-composer-card] button[class*='_primary'][aria-busy] {
    background:
      radial-gradient(ellipse at 30% 4%, rgb(149 246 230 / 34%), transparent 58%),
      linear-gradient(155deg, #208e94, #006f78 53%, #00525e);
    box-shadow:
      inset 0 1px 1px rgb(219 255 248 / 64%),
      inset 0 -1px 2px rgb(0 54 64 / 44%),
      0 0 0 1px rgb(0 83 90 / 26%),
      0 2px 4px rgb(0 67 75 / 22%);
    transition: filter 120ms ease, scale 100ms ease, box-shadow 120ms ease;
  }

  @media (hover: hover) {
    html[data-dsh-studio-skin='sea'] [data-composer-card] button[class*='_primary'][aria-busy]:enabled:hover {
      filter: brightness(1.08);
    }
  }

  html[data-dsh-studio-skin='sea'] [data-composer-card] button[class*='_primary'][aria-busy]:enabled:active {
    scale: var(--dsws-send-pressed-scale, 0.96);
    box-shadow: inset 0 2px 3px rgb(0 50 60 / 45%), 0 0 0 1px rgb(0 83 90 / 30%);
  }

  html[data-dsh-studio-skin='sea'] [data-composer-card] button[class*='_primary'][aria-busy]:focus-visible {
    outline: 2px solid #006f78;
    outline-offset: 3px;
  }

  html[data-dsh-studio-skin='sea'] [data-composer-card] button[class*='_primary'][aria-busy]:disabled:not([data-sending]) {
    background: linear-gradient(155deg, #a8cbca, #80aaae);
    opacity: 1;
    box-shadow: inset 0 1px 1px rgb(255 255 255 / 55%), 0 0 0 1px rgb(37 103 110 / 14%);
  }

  @media (prefers-reduced-motion: reduce) {
    html[data-dsh-studio-skin='sea'] [data-composer-card] button[class*='_primary'][aria-busy] {
      transition: none;
      --dsws-send-pressed-scale: 1;
    }
  }
}
`;
    }

    /** 应用 / 清除内置主题皮肤。 */
    function applySkin(skin) {
      if (typeof document === 'undefined') return;
      const custom = skin !== 'default' && THEME_SKIN_OPTIONS.includes(skin);
      let style = document.getElementById(SKIN_STYLE_ID);
      if (!custom) {
        if (style !== null) style.remove();
        if (document.documentElement !== null) document.documentElement.removeAttribute(SKIN_ATTR);
        syncHostDarkMarker('default');
        return;
      }
      if (style === null) {
        style = document.createElement('style');
        style.id = SKIN_STYLE_ID;
        document.head.appendChild(style);
      }
      // 每次都重写内容：热更新或旧样式节点可能只带部分皮肤规则。
      style.textContent = builtInSkinCss();
      if (document.documentElement !== null) document.documentElement.setAttribute(SKIN_ATTR, skin);
      // 深海夜航要触发宿主深色分支；浅海晨汐则要移走深色标记，避免宿主/插件的深色样式渗进来。
      syncHostDarkMarker(skin);
    }

    /**
     * 左下角状态提示（账号上方）：价格时段与账户余额两个开关各自控制一行。
     * 两行由同一个组件纵向排列，避免 footer 的横向 flex 把它们并排放。
     * @param {any} settingsStore 设置存储。
     * @param {any} balanceStore 余额存储。
     * @returns 注册到 sidebar.footer.action 的 React 组件。
     */
    function createFooterStatus(settingsStore, balanceStore) {
      return function FooterStatus({ wide, t }) {
        const settings = useStoreValue(settingsStore);
        const balance = useStoreValue(balanceStore);
        const pricingOn = settings.pricingIndicator === true;
        const balanceOn = settings.balanceIndicator === true;
        const pricing = usePricing(pricingOn);
        // 余额开关打开后读取一次；不轮询，手动刷新在工作台页面里。
        useEffect(() => {
          if (balanceOn && balance.status === 'idle') void balanceStore.load();
        }, [balanceOn, balance.status]);
        if (!pricingOn && !balanceOn) return null;
        const rows = [];
        if (pricingOn) {
          const peak = pricing.period === 'peak';
          const pricingLabel = t(peak ? 'pricing.peakLabel' : 'pricing.idleLabel');
          const pricingTitle = [
            t(peak ? 'pricing.peakTitle' : 'pricing.idleTitle'),
            t('pricing.nextSwitch', { time: formatSwitchTime(pricing.nextSwitchAt) }),
            t('pricing.rule'),
          ].join('\n');
          rows.push(h(
            'div',
            {
              key: 'pricing',
              className: wide ? 'dsws-badge dsws-badgeWide' : 'dsws-badge',
              'data-period': peak ? 'peak' : 'offpeak',
              role: 'status',
              'aria-live': 'polite',
              'aria-label': pricingTitle,
              tabIndex: 0,
              title: pricingTitle,
            },
            h('span', { className: 'dsws-badgeDot', 'aria-hidden': true }),
            // 收起为图标栏时没有可见文案，用只给读屏器的文本补全；展开时避免重复朗读。
            wide
              ? h('span', { className: 'dsws-badgeLabel' }, pricingLabel)
              : h('span', { className: 'dsws-badgeSrOnly' }, pricingLabel),
          ));
        }
        if (balanceOn) {
          const amount = formatBalanceTotal(balance.wallets, balance.bonusWallets);
          // 自动刷新期间保留上一次金额；还没有任何读数时才显示省略号或「暂不可用」。
          const hasValue = balance.status === 'ready' || balance.updatedAt !== undefined;
          const stateText = hasValue
            ? amount
            : balance.status === 'loading' || balance.status === 'idle'
              ? '…'
              : t('balance.unavailable');
          const balanceTitle = [
            `${t('balance.label')} ${stateText}`,
            balance.updatedAt === undefined ? '' : t('balance.updated', { time: formatSwitchTime(balance.updatedAt) }),
            balance.error === undefined ? '' : t('balance.error', { message: balance.error }),
          ].filter((part) => part !== '').join('，');
          rows.push(h(
            'div',
            {
              key: 'balance',
              className: wide ? 'dsws-badge dsws-badgeWide' : 'dsws-badge',
              'data-tone': 'balance',
              'data-state': hasValue ? 'ready' : 'muted',
              role: 'status',
              'aria-live': 'polite',
              'aria-label': balanceTitle,
              tabIndex: 0,
              title: balanceTitle,
            },
            h('span', { className: 'dsws-badgeDot', 'aria-hidden': true }),
            wide
              ? h(
                  'span',
                  { className: 'dsws-badgeLabel' },
                  `${t('balance.label')} `,
                  h('span', { className: 'dsws-badgeAmount' }, stateText),
                )
              : h('span', { className: 'dsws-badgeSrOnly' }, balanceTitle),
          ));
        }
        return h(
          Fragment,
          null,
          h('style', { key: 'style' }, BADGE_CSS),
          h('div', { key: 'stack', className: 'dsws-foot', 'data-wide': wide ? 'true' : 'false' }, rows),
        );
      };
    }

    /**
     * 工作台页面：概览（价格刻度尺 + 读数卡）与功能配置（分组网格）两个视图。
     * 结构按可扩展方式组织：视图、概览卡片与配置分组都是数据驱动的列表，
     * 以后新增模块只需往对应数组里追加条目，布局会自动适配。
     * @param {any} ctx Client 根上下文。
     * @param {any} settingsStore 设置存储。
     * @param {any} balanceStore 余额存储。
     * @returns {Function} 页面组件。
     */
    function createPage(ctx, settingsStore, balanceStore) {
      /** 面板主体：读取、筛选与渲染两类技能，并切换概览/配置布局。 */
      function StudioPage({ t }) {
        const [state, setState] = useState({
          status: 'loading',
          global: [],
          user: [],
          complete: true,
          error: undefined,
        });
        const [query, setQuery] = useState('');
        const [reloadKey, setReloadKey] = useState(0);
        // 当前视图：概览、个性化界面、技能。
        const [view, setView] = useState('overview');
        // 两个技能分组默认收起；每个技能的详情也默认收起，点名称才展开。
        const [openSections, setOpenSections] = useState({ global: false, user: false });
        const [openSkills, setOpenSkills] = useState({});
        // 刻度尺的“现在”光标在首帧后滑到真实位置，形成唯一一次入场动效。
        const [rulerReady, setRulerReady] = useState(false);
        // 搜索框引用：从概览的「管理技能」切过来时把焦点直接送到它上面。
        const searchRef = useRef(null);
        // 页面开关与左下角提示共用同一份设置；页面打开时确保已经读取过一次。
        const settings = useStoreValue(settingsStore);
        const balance = useStoreValue(balanceStore);
        useEffect(() => {
          if (settings.status === 'idle') void settingsStore.load();
        }, [settings.status]);
        // 余额开关打开且尚未读取时读取一次；页面打开时也能看到最新余额。
        useEffect(() => {
          if (settings.balanceIndicator === true && balance.status === 'idle') void balanceStore.load();
        }, [settings.balanceIndicator, balance.status]);

        // 搜索时自动展开两个分组，否则收起状态下会看起来“没有结果”。
        useEffect(() => {
          if (query.trim() === '') return;
          setOpenSections((previous) => (previous.global && previous.user ? previous : { global: true, user: true }));
        }, [query]);

        // 刻度尺入场：首帧后把光标从 0 滑到当前位置；不支持 rAF 时退化为延时。
        useEffect(() => {
          const reveal = () => setRulerReady(true);
          if (typeof window.requestAnimationFrame === 'function') {
            const frame = window.requestAnimationFrame(reveal);
            return () => {
              if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
            };
          }
          const timer = window.setTimeout(reveal, 60);
          return () => window.clearTimeout(timer);
        }, []);

        // 挂载、手动刷新与宿主事件触发时读取技能；卸载会中止在途请求。
        useEffect(() => {
          let active = true;
          const abort = new AbortController();
          setState((previous) => ({ ...previous, status: 'loading', error: undefined }));
          void (async () => {
            try {
              const result = await fetchSkills(abort.signal);
              if (!active) return;
              setState({
                status: 'ready',
                global: result.global,
                user: result.user,
                complete: result.complete,
                error: undefined,
              });
            } catch (error) {
              if (!active || abort.signal.aborted) return;
              // 刷新失败时保留上一份列表，只把错误作为提示条显示。
              setState((previous) => ({ ...previous, status: 'error', error: classifyFailure(error) }));
            }
          })();
          return () => {
            active = false;
            abort.abort();
          };
        }, [reloadKey]);

        // 技能目录会随插件安装/停用变化；连接重置后重新读取。
        useEffect(() => {
          const reload = () => setReloadKey((key) => key + 1);
          const disposers = [];
          try {
            disposers.push(ctx.remote.$on('plugin-manager/changed', reload));
          } catch {}
          try {
            disposers.push(ctx.on('connection/reset', reload));
          } catch {}
          return () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch {}
            }
          };
        }, []);

        // 按名称、描述、适用场景在本地筛选两类列表，不额外请求 Host。
        const visible = useMemo(() => {
          const needle = query.trim().toLowerCase();
          const match = (skill) => {
            if (needle === '') return true;
            const haystack = [skill.name, skill.description, skill.whenToUse]
              .filter((value) => typeof value === 'string')
              .join('\n')
              .toLowerCase();
            return haystack.includes(needle);
          };
          return { global: state.global.filter(match), user: state.user.filter(match) };
        }, [state.global, state.user, query]);

        const loading = state.status === 'loading';
        const globalTotal = state.global.length;
        const userTotal = state.user.length;
        const total = globalTotal + userTotal;
        const failure = state.status === 'error' ? state.error : undefined;

        // 价格时段与 24 小时刻度尺；页面始终需要实时数据，因此保持 active。
        const pricingOn = settings.pricingIndicator === true;
        const pricing = usePricing(true);
        const periodLabel = pricing.period === 'peak' ? t('pricing.peakLabel') : t('pricing.idleLabel');

        // 刻度尺数据：两个高峰区间的位置、当前时刻、距下次切换的时长。
        const ruler = useMemo(() => {
          const stamp = pricing.now;
          const beijing = new Date(stamp + 8 * 60 * 60 * 1000);
          const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes() + beijing.getUTCSeconds() / 60;
          const dayKey = beijing.toISOString().slice(0, 10);
          const weekday = beijing.getUTCDay() >= 1 && beijing.getUTCDay() <= 5;
          const holiday = HOLIDAYS.has(dayKey);
          const percent = (value) => Math.max(0, Math.min(100, (value / 1440) * 100));
          const remaining = Math.max(0, pricing.nextSwitchAt - stamp);
          const minutesLeft = Math.max(1, Math.ceil(remaining / 60000));
          const hours = Math.floor(minutesLeft / 60);
          const minutePart = minutesLeft % 60;
          const duration = hours > 0
            ? minutePart === 0
              ? t('ruler.durationHoursOnly', { hours })
              : t('ruler.durationHours', { hours, minutes: minutePart })
            : t('ruler.durationMinutes', { minutes: minutesLeft });
          return {
            weekday,
            holiday,
            live: weekday && !holiday,
            clock: formatBeijingClock(stamp),
            nowPercent: percent(minutes),
            bands: [
              { key: 'morning', left: percent(9 * 60), width: percent(12 * 60) - percent(9 * 60) },
              { key: 'afternoon', left: percent(14 * 60), width: percent(18 * 60) - percent(14 * 60) },
            ],
            labels: [
              { key: '00', left: 0, text: '00:00', edge: 'start' },
              { key: '09', left: percent(9 * 60), text: '09:00' },
              { key: '12', left: percent(12 * 60), text: '12:00', optional: true },
              { key: '14', left: percent(14 * 60), text: '14:00' },
              { key: '18', left: percent(18 * 60), text: '18:00' },
              { key: '24', left: 100, text: '24:00', edge: 'end' },
            ],
            duration,
            nextIsPeak: pricing.period !== 'peak',
            note: [
              holiday ? t('ruler.holiday') : !weekday ? t('ruler.weekend') : '',
            ].filter((part) => part !== '').join(' '),
          };
        }, [pricing, t]);
        const countdown = ruler.nextIsPeak
          ? t('ruler.nextPeak', { duration: ruler.duration })
          : t('ruler.nextOffpeak', { duration: ruler.duration });

        // 左下角状态提示的两个开关与余额读数。
        const balanceOn = settings.balanceIndicator === true;
        const settingsBusy = settings.status === 'loading' || settings.saving;
        const balanceAmount = formatBalanceTotal(balance.wallets, balance.bonusWallets);
        // 自动刷新期间保留上一次金额，避免每次刷新都闪成「读取中」。
        const balanceHasValue = balance.status === 'ready' || balance.updatedAt !== undefined;
        const balanceLine = balanceHasValue
          ? `${t('balance.current', { amount: balanceAmount })}${
              balance.updatedAt === undefined ? '' : `，${t('balance.updated', { time: formatSwitchTime(balance.updatedAt) })}`
            }${
              balance.error === undefined ? '' : `，${t('balance.error', { message: balance.error })}`
            }`
          : balance.status === 'loading' || balance.status === 'idle'
            ? t('balance.loading')
            : balance.error === undefined
              ? t('balance.unavailable')
              : t('balance.error', { message: balance.error });

        // 错误码 → 页面文案。
        const failureText = (() => {
          if (failure === undefined) return '';
          if (failure.code === 'unauthorized') return t('skills.errorUnauthorized');
          if (failure.code === 'unavailable') return t('skills.errorUnavailable');
          if (failure.code === 'network') {
            return t('skills.errorNetwork', { message: failure.detail ?? '' });
          }
          return t('skills.error', { message: failure.detail ?? failure.code });
        })();

        const retryButton = h(
          'button',
          {
            type: 'button',
            className: 'dsws-button',
            onClick: () => setReloadKey((key) => key + 1),
          },
          t('skills.retry'),
        );

        // 认证失败时重试没有意义：给出重新加载页面的动作。
        const reloadButton = h(
          'button',
          {
            type: 'button',
            className: 'dsws-button',
            onClick: () => {
              window.location.reload();
            },
          },
          t('skills.reloadPage'),
        );
        const failureAction = failure !== undefined && failure.code === 'unauthorized'
          ? reloadButton
          : retryButton;

        // 一个技能条目：默认只显示名称，点击名称才展开详情。
        const skillRow = (skill, kind) => {
          const key = `${kind}:${skill.name}`;
          const open = openSkills[key] === true;
          const panelId = `dsws-skill-${kind}-${String(skill.name).replace(/[^\w-]/g, '_')}`;
          const badges = skillBadges(skill, t);
          return h(
            'li',
            { className: 'dsws-skillRow', key: skill.name },
            h(
              'button',
              {
                type: 'button',
                className: 'dsws-skillToggle',
                'aria-expanded': open ? 'true' : 'false',
                'aria-controls': panelId,
                onClick: () => setOpenSkills((previous) => ({ ...previous, [key]: !(previous[key] === true) })),
              },
              h('span', { className: 'dsws-chevron', 'data-open': open ? 'true' : 'false', 'aria-hidden': true }),
              h('span', { className: 'dsws-skillName' }, skill.name),
            ),
            open
              ? h(
                  'div',
                  { className: 'dsws-skillDetails', id: panelId, role: 'region', 'aria-label': skill.name },
                  badges.length > 0 ? h('div', { className: 'dsws-nameRow' }, badges) : null,
                  h('p', { className: 'dsws-desc' }, skill.description),
                  skill.whenToUse
                    ? h(
                        'p',
                        { className: 'dsws-when' },
                        h('span', { className: 'dsws-whenLabel' }, t('skills.whenToUse')),
                        skill.whenToUse,
                      )
                    : null,
                  skill.path ? h('p', { className: 'dsws-path' }, skill.path) : null,
                )
              : null,
          );
        };

        // 一类技能的小节：可展开/收起的标题、数量、说明与列表（默认收起）。
        const section = (kind, items, visibleItems) => {
          const sectionTotal = items.length;
          const expanded = openSections[kind] === true;
          const panelId = `dsws-skills-${kind}`;
          const countText = query.trim() !== '' && visibleItems.length !== sectionTotal
            ? t('skills.countFiltered', { visible: visibleItems.length, total: sectionTotal })
            : t(sectionTotal === 1 ? 'skills.countOne' : 'skills.count', { count: sectionTotal });
          let content = null;
          if (expanded) {
            if (sectionTotal === 0) {
              content = h(
                'div',
                { className: 'dsws-empty' },
                h(
                  'p',
                  { className: 'dsws-emptyText' },
                  t(kind === 'global' ? 'skills.emptyGlobal' : 'skills.emptyUser'),
                ),
              );
            } else if (visibleItems.length === 0) {
              content = h(
                'div',
                { className: 'dsws-empty' },
                h('p', { className: 'dsws-emptyText' }, t('skills.emptyFiltered', { query: query.trim() })),
              );
            } else {
              content = h('ul', { className: 'dsws-list' }, visibleItems.map((skill) => skillRow(skill, kind)));
            }
          }
          return h(
            'section',
            { className: 'dsws-section', key: kind },
            h(
              'div',
              { className: 'dsws-sectionHead' },
              h(
                'h3',
                { className: 'dsws-sectionHeading' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsws-sectionToggle',
                    'aria-expanded': expanded ? 'true' : 'false',
                    'aria-controls': panelId,
                    onClick: () => setOpenSections((previous) => ({ ...previous, [kind]: !(previous[kind] === true) })),
                  },
                  h('span', { className: 'dsws-chevron', 'data-open': expanded ? 'true' : 'false', 'aria-hidden': true }),
                  h('span', { className: 'dsws-sectionTitle' }, t(`skills.${kind}.title`)),
                ),
              ),
              sectionTotal > 0 ? h('span', { className: 'dsws-count' }, countText) : null,
            ),
            h('p', { className: 'dsws-sectionSub' }, t(`skills.${kind}.subtitle`)),
            expanded
              ? h('div', { id: panelId, role: 'region', 'aria-label': t(`skills.${kind}.title`) }, content)
              : null,
          );
        };

        // 主体：加载骨架、整页错误、整页无匹配、或两类小节。
        const noMatches = query.trim() !== '' && total > 0
          && visible.global.length === 0 && visible.user.length === 0;
        let body;
        if (loading && total === 0) {
          body = h(
            'div',
            { 'aria-busy': 'true' },
            h('p', { className: 'dsws-note' }, t('skills.loading')),
            h(
              'div',
              { className: 'dsws-skeleton' },
              h('div', { className: 'dsws-skeletonBar', 'data-width': 'name' }),
              h('div', { className: 'dsws-skeletonBar', 'data-width': 'desc' }),
              h('div', { className: 'dsws-skeletonBar', 'data-width': 'path' }),
            ),
            h(
              'div',
              { className: 'dsws-skeleton' },
              h('div', { className: 'dsws-skeletonBar', 'data-width': 'name' }),
              h('div', { className: 'dsws-skeletonBar', 'data-width': 'desc' }),
            ),
          );
        } else if (total === 0 && failure !== undefined) {
          body = h(
            'div',
            { className: 'dsws-error', role: 'alert' },
            h('p', { className: 'dsws-errorText' }, failureText),
            failureAction,
          );
        } else if (noMatches) {
          // 两类都没有匹配时给一条整页提示，避免两个小节各显示一遍空态。
          body = h(
            'div',
            { className: 'dsws-empty' },
            h('p', { className: 'dsws-emptyText' }, t('skills.emptyFiltered', { query: query.trim() })),
          );
        } else {
          body = h(Fragment, null, section('global', state.global, visible.global), section('user', state.user, visible.user));
        }

        // 有旧数据时错误只作为提示条出现，列表保持可用。
        const failureBanner = failure === undefined || total === 0
          ? null
          : h(
              'div',
              { className: 'dsws-error', role: 'alert' },
              h('p', { className: 'dsws-errorText' }, failureText),
              failureAction,
            );

        // 有内容时才需要提示来源不完整；空列表由各小节空态自己说明。
        const incompleteNotice = state.complete === false && total > 0
          ? h('p', { className: 'dsws-warn' }, t('skills.incomplete'))
          : null;

        // 读屏器只播报一次性的状态变化；筛选数量不进入此区域，避免每次按键都播报。
        const statusText = loading
          ? t('skills.loading')
          : failure !== undefined
            ? ''
            : [
                total === 0 ? '' : t('skills.loaded', { global: globalTotal, user: userTotal }),
                state.complete === false ? t('skills.incomplete') : '',
              ].filter((part) => part !== '').join(' ');

        // 一行开关：左侧文案，右侧 switch。
        const switchRow = (key, label, hint, checked, onChange) => h(
          'div',
          { className: 'dsws-settingRow', key },
          h(
            'div',
            { className: 'dsws-settingText' },
            h('span', { className: 'dsws-settingLabel' }, label),
            h('span', { className: 'dsws-settingHint' }, hint),
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': checked ? 'true' : 'false',
              'aria-label': label,
              className: 'dsws-switch',
              'data-on': checked ? 'true' : 'false',
              'aria-disabled': settingsBusy ? 'true' : undefined,
              onClick: () => { if (settingsBusy) return; onChange(); },
            },
            h('span', { className: 'dsws-switchKnob', 'aria-hidden': true }),
          ),
        );

        // 余额自动更新间隔的下拉行。
        const autoRefreshRow = h(
          'div',
          { className: 'dsws-settingRow' },
          h(
            'div',
            { className: 'dsws-settingText' },
            h('span', { className: 'dsws-settingLabel' }, t('balance.autoRefresh')),
            h('span', { className: 'dsws-settingHint' }, t('balance.autoHint')),
          ),
          h(
            'select',
            {
              className: 'dsws-select',
              value: String(settings.balanceRefreshMs ?? 0),
              'aria-label': t('balance.autoRefresh'),
              'aria-disabled': settingsBusy ? 'true' : undefined,
              onChange: (event) => {
                if (settingsBusy) return;
                void settingsStore.setSetting('balanceRefreshMs', Number(event.target.value));
              },
            },
            h('option', { value: '0' }, t('balance.autoOff')),
            h('option', { value: '10000' }, t('balance.auto10s')),
            h('option', { value: '30000' }, t('balance.auto30s')),
            h('option', { value: '60000' }, t('balance.auto1m')),
            h('option', { value: '300000' }, t('balance.auto5m')),
          ),
        );

        // 设置读取/保存状态：只出现一次，放在配置页顶部。
        const settingsNotice = settings.status === 'loading'
          ? h('p', { className: 'dsws-note' }, t('pricing.loading'))
          : settings.error !== undefined
            ? h(
                'div',
                { className: 'dsws-error', role: 'alert' },
                h('p', { className: 'dsws-errorText' }, t('pricing.error', { message: settings.error })),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsws-button',
                    onClick: () => {
                      void settingsStore.load();
                    },
                  },
                  t('pricing.retry'),
                ),
              )
            : settings.saving
              ? h('p', { className: 'dsws-note' }, t('pricing.saving'))
              : null;

        const goInterface = () => setView('interface');
        // 跳到技能页并把焦点送到技能搜索框；没有搜索框（无技能）时忽略。
        const goSkills = () => {
          setView('skills');
          const focus = () => {
            if (searchRef.current !== null && typeof searchRef.current.focus === 'function') {
              searchRef.current.focus();
            }
          };
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
          else window.setTimeout(focus, 0);
        };

        // 视图列表：新增视图时在此追加一项即可。
        const VIEWS = [
          { id: 'overview', label: t('nav.overview') },
          { id: 'interface', label: t('nav.interface') },
          { id: 'skills', label: t('nav.skills') },
        ];

        // 读数卡：标题、主值、说明行与操作。
        const statCard = (key, title, value, options = {}) => h(
          'article',
          { className: 'dsws-stat', key },
          h(
            'div',
            { className: 'dsws-statHead' },
            options.lamp === undefined
              ? null
              : h('span', { className: 'dsws-lamp', 'data-tone': options.lamp, 'aria-hidden': true }),
            h('h2', { className: 'dsws-statTitle' }, title),
          ),
          value === null || value === undefined
            ? null
            : h(
                'div',
                { className: 'dsws-statValue', 'data-small': options.small === true ? 'true' : undefined },
                value,
                options.unit === undefined ? null : h('span', { className: 'dsws-statUnit' }, options.unit),
              ),
          options.rows === undefined ? null : h('div', { className: 'dsws-statRows' }, options.rows),
          options.actions === undefined ? null : h('div', { className: 'dsws-statActions' }, options.actions),
        );

        // 技能占比条：全局（深）与用户（浅）按数量分配宽度。
        const skillBar = total === 0
          ? null
          : h(
              Fragment,
              null,
              h(
                'div',
                { className: 'dsws-bar', 'aria-hidden': true },
                h('span', { className: 'dsws-barSeg', 'data-tone': 'global', style: { flexGrow: globalTotal } }),
                h('span', { className: 'dsws-barSeg', 'data-tone': 'user', style: { flexGrow: userTotal } }),
              ),
              h(
                'div',
                { className: 'dsws-barLegend' },
                h(
                  'span',
                  null,
                  h('span', { className: 'dsws-legendDot', 'data-tone': 'global', 'aria-hidden': true }),
                  t('skills.global.title'),
                  ' ',
                  globalTotal,
                ),
                h(
                  'span',
                  null,
                  h('span', { className: 'dsws-legendDot', 'data-tone': 'user', 'aria-hidden': true }),
                  t('skills.user.title'),
                  ' ',
                  userTotal,
                ),
              ),
            );

        // 概览里的紧凑开关：状态与控件同卡，避免为了改状态来回切视图。
        const compactSwitch = (key, label, checked, onChange, ariaLabel) => h(
          'div',
          { className: 'dsws-statRow', key },
          h('span', null, label),
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              className: 'dsws-switch dsws-switchSmall',
              'aria-checked': checked ? 'true' : 'false',
              'aria-label': ariaLabel,
              'aria-disabled': settingsBusy ? 'true' : undefined,
              'data-on': checked ? 'true' : 'false',
              onClick: () => { if (settingsBusy) return; onChange(); },
            },
            h('span', { className: 'dsws-switchKnob', 'aria-hidden': true }),
          ),
        );

        // 概览读数卡：只保留简要功能说明与当前状态；详细设置都在「功能配置」里。
        const stats = [
          statCard('skills', t('overview.skills'), loading && total === 0 ? '…' : String(total), {
            unit: t('overview.skillsUnit'),
            rows: [
              h('p', { className: 'dsws-note' }, t('overview.skillsIntro')),
              skillBar === null
                ? h('p', { className: 'dsws-note' }, loading ? t('overview.loading') : t('overview.skillsEmpty'))
                : skillBar,
            ],
            actions: [
              h('button', { type: 'button', className: 'dsws-button', onClick: goSkills }, t('overview.manageSkills')),
            ],
          }),
          statCard(
            'balance',
            t('overview.balance'),
            balanceOn
              ? balanceHasValue
                ? balanceAmount
                : balance.status === 'loading' || balance.status === 'idle'
                  ? '…'
                  : t('balance.unavailable')
              : t('overview.off'),
            {
              small: true,
              lamp: balanceOn && balanceHasValue ? 'brand' : undefined,
              rows: [
                h('p', { className: 'dsws-note' }, t('overview.balanceIntro')),
                balance.error === undefined
                  ? null
                  : h('p', { className: 'dsws-note' }, t('balance.error', { message: balance.error })),
              ],
            },
          ),
          statCard('hints', t('overview.hints'), null, {
            small: true,
            rows: [
              h('p', { className: 'dsws-note' }, t('overview.hintsIntro')),
              compactSwitch(
                'pricing',
                t('pricing.footerLabel'),
                pricingOn,
                () => { void settingsStore.setSetting('pricingIndicator', !pricingOn); },
                t('pricing.toggleLabel'),
              ),
              compactSwitch(
                'balance',
                t('balance.label'),
                balanceOn,
                () => { void settingsStore.setSetting('balanceIndicator', !balanceOn); },
                t('balance.toggleLabel'),
              ),
            ],
          }),
        ].filter((card) => card !== null);

        // 价格刻度尺：高峰区间、整点刻度、当前时刻光标与倒计时。
        const hero = h(
          'section',
          { className: 'dsws-hero' },
          h(
            'div',
            { className: 'dsws-heroTop' },
            h(
              'div',
              { className: 'dsws-heroHead' },
              h('p', { className: 'dsws-heroKicker' }, t('ruler.beijing')),
              h(
                'p',
                { className: 'dsws-heroState' },
                h('span', { className: 'dsws-lamp', 'data-tone': pricing.period === 'peak' ? 'warn' : 'success', 'aria-hidden': true }),
                periodLabel,
              ),
              h('p', { className: 'dsws-heroMeta' }, `${t('ruler.now', { time: ruler.clock })}；${countdown}`),
            ),
            h('button', { type: 'button', className: 'dsws-button', onClick: goInterface }, t('overview.goInterface')),
          ),
          h(
            'div',
            {
              className: 'dsws-ruler',
              role: 'img',
              'aria-label': t('ruler.aria', { time: ruler.clock, state: periodLabel }),
            },
            h(
              'div',
              { className: 'dsws-rulerTrack' },
              ruler.bands.map((band) => h('span', {
                key: band.key,
                className: 'dsws-rulerBand',
                'data-live': ruler.live ? 'true' : 'false',
                style: { left: `${band.left}%`, width: `${band.width}%` },
              })),
            ),
            h('div', { className: 'dsws-rulerTicks', 'aria-hidden': true }),
            ruler.labels.map((label) => h(
              'span',
              {
                key: label.key,
                className: 'dsws-rulerLabel',
                'data-edge': label.edge,
                'data-optional': label.optional === true ? 'true' : undefined,
                style: { left: `${label.left}%` },
              },
              label.text,
            )),
            h('div', {
              className: 'dsws-rulerNow',
              'aria-hidden': true,
              style: { left: `${rulerReady ? ruler.nowPercent : 0}%` },
            }),
          ),
          h(
            'p',
            { className: 'dsws-rulerLegend' },
            h(
              'span',
              { className: 'dsws-legendKey' },
              h('span', { className: 'dsws-swatch', 'data-tone': 'peak', 'data-live': ruler.live ? 'true' : 'false', 'aria-hidden': true }),
              t('ruler.peakKey'),
            ),
            h(
              'span',
              { className: 'dsws-legendKey' },
              h('span', { className: 'dsws-swatch', 'aria-hidden': true }),
              t('ruler.idleKey'),
            ),
          ),
          h(
            'p',
            { className: 'dsws-note' },
            [t('ruler.rule'), ruler.note].filter((part) => part !== '').join(' '),
          ),
        );

        // 个性化界面：左下角状态开关与余额刷新设置。
        const interfaceView = h(
          'section',
          { className: 'dsws-group' },
          h(
            'div',
            { className: 'dsws-groupHead' },
            h(
              'div',
              null,
              h('h2', { className: 'dsws-groupTitle' }, t('interface.viewTitle')),
              h('p', { className: 'dsws-groupSub' }, t('interface.viewDesc')),
            ),
          ),
          h(
            'div',
            { className: 'dsws-groupBody' },
            switchRow(
              'pricing',
              t('pricing.toggleLabel'),
              t('pricing.toggleHint'),
              pricingOn,
              () => { void settingsStore.setSetting('pricingIndicator', !pricingOn); },
            ),
            switchRow(
              'balance',
              t('balance.toggleLabel'),
              t('balance.toggleHint'),
              balanceOn,
              () => { void settingsStore.setSetting('balanceIndicator', !balanceOn); },
            ),
            balanceOn ? autoRefreshRow : null,
            balanceOn
              ? h(
                  'div',
                  { className: 'dsws-balanceRow' },
                  h('p', { className: 'dsws-note' }, balanceLine),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsws-button',
                      'aria-disabled': balance.status === 'loading' ? 'true' : undefined,
                      onClick: () => {
                        if (balance.status === 'loading') return;
                        void balanceStore.load();
                      },
                    },
                    t('balance.refresh'),
                  ),
                )
              : null,
          ),
        );

        // 主题：内置浅色皮肤（浅海晨汐）。
        const themeView = h(
          'section',
          { className: 'dsws-group' },
          h(
            'div',
            { className: 'dsws-groupHead' },
            h(
              'div',
              null,
              h('h2', { className: 'dsws-groupTitle' }, t('theme.viewTitle')),
              h('p', { className: 'dsws-groupSub' }, t('theme.viewDesc')),
            ),
          ),
          h(
            'div',
            { className: 'dsws-groupBody' },
            h(
              'div',
              { className: 'dsws-settingRow' },
              h(
                'div',
                { className: 'dsws-settingText' },
                h('span', { className: 'dsws-settingLabel' }, t('theme.skinLabel')),
                h('span', { className: 'dsws-settingHint' }, t('theme.skinHint')),
              ),
              h(
                'select',
                {
                  className: 'dsws-select',
                  value: settings.themeSkin,
                  'aria-label': t('theme.skinLabel'),
                  'aria-disabled': settingsBusy ? 'true' : undefined,
                  onChange: (event) => {
                    if (settingsBusy) return;
                    void settingsStore.setSetting('themeSkin', event.target.value);
                  },
                },
                h('option', { value: 'default' }, t('theme.skinDefault')),
                h('option', { value: 'sea' }, t('theme.skinSea')),
                h('option', { value: 'night' }, t('theme.skinNight')),
              ),
            ),
          ),
        );

        // 技能：只读清单、搜索与来源说明。
        const skillsView = h(
          'section',
          { className: 'dsws-group' },
          h(
            'div',
            { className: 'dsws-groupHead' },
            h(
              'div',
              null,
              h('h2', { className: 'dsws-groupTitle' }, t('skills.viewTitle')),
              h('p', { className: 'dsws-groupSub' }, t('skills.viewDesc')),
            ),
          ),
          h(
            'div',
            { className: 'dsws-groupBody' },
            total > 0
              ? h(
                  'div',
                  { className: 'dsws-toolbar' },
                  h('input', {
                    ref: searchRef,
                    className: 'dsws-search',
                    type: 'search',
                    value: query,
                    'aria-label': t('skills.search'),
                    placeholder: t('skills.searchPlaceholder'),
                    onChange: (event) => setQuery(event.target.value),
                  }),
                )
              : null,
            h('p', { className: 'dsws-srOnly', role: 'status', 'aria-live': 'polite' }, statusText),
            incompleteNotice,
            failureBanner,
            body,
          ),
        );

        // 当前视图内容：概览是刻度尺 + 读数卡，另两个视图各是一块单列面板。
        const pageBody = view === 'overview'
          ? h(
              Fragment,
              null,
              settings.error === undefined ? null : settingsNotice,
              failureBanner,
              hero,
              h('div', { className: 'dsws-stats' }, stats),
            )
          : view === 'interface'
            ? h('div', { className: 'dsws-groupList' }, settingsNotice, interfaceView, themeView)
            : h('div', { className: 'dsws-groupList' }, skillsView);

        return h(
          'div',
          { className: 'dsws-page' },
          h('style', null, CSS),
          h(
            'header',
            { className: 'dsws-head', 'data-window-drag': true },
            h(
              'div',
              { className: 'dsws-headTop' },
              h(
                'div',
                { className: 'dsws-headText' },
                h('h1', { className: 'dsws-title' }, t('title')),
                h('p', { className: 'dsws-intro' }, t('intro')),
              ),
              h(
                'div',
                { className: 'dsws-headActions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsws-iconButton',
                    title: t('skills.refresh'),
                    'aria-label': t('skills.refresh'),
                    'aria-busy': loading ? 'true' : undefined,
                    'data-busy': loading ? 'true' : undefined,
                    onClick: () => {
                      // 读取中忽略重复点击，同时保留键盘焦点（不禁用按钮）。
                      if (loading) return;
                      setReloadKey((key) => key + 1);
                    },
                  },
                  h(RefreshGlyph),
                ),
              ),
            ),
            h(
              'nav',
              { className: 'dsws-tabs', role: 'tablist', 'aria-label': t('nav.label') },
              VIEWS.map((entry) => h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  role: 'tab',
                  id: `dsws-tab-${entry.id}`,
                  className: 'dsws-tab',
                  'data-active': view === entry.id ? 'true' : 'false',
                  'aria-selected': view === entry.id ? 'true' : 'false',
                  'aria-controls': `dsws-panel-${entry.id}`,
                  tabIndex: view === entry.id ? 0 : -1,
                  onKeyDown: (event) => {
                    // 页签按 WAI-ARIA 的 roving tabindex 约定支持方向键与 Home/End。
                    const order = VIEWS.map((item) => item.id);
                    const index = order.indexOf(view);
                    if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      setView(order[(index + 1) % order.length]);
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      setView(order[(index - 1 + order.length) % order.length]);
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      setView(order[0]);
                    } else if (event.key === 'End') {
                      event.preventDefault();
                      setView(order[order.length - 1]);
                    }
                  },
                  onClick: () => setView(entry.id),
                },
                entry.label,
              )),
            ),
          ),
          h(
            'div',
            { className: 'dsws-scroll' },
            h(
              'div',
              {
                className: 'dsws-body',
                id: `dsws-panel-${view}`,
                role: 'tabpanel',
                'aria-labelledby': `dsws-tab-${view}`,
                tabIndex: 0,
              },
              pageBody,
              h('p', { className: 'dsws-note' }, t('skills.note')),
            ),
          ),
        );
      }

      return StudioPage;
    }

    return {
      // 依赖 Client 服务：插槽、文案，以及读取宿主事件（插件变更、连接重置）的 Remote。
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        // 注册工作台文案字典，缺省语言回退到英文。
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-studio: dictionaries');
        const t = ctx.locale.bind(NS);
        const settingsStore = createSettingsStore();
        // 初始值用于「默认」皮肤恢复宿主自己的深色标记。
        hostColorSchemeDark = typeof document !== 'undefined' && document.body !== null && document.body !== undefined && document.body.hasAttribute('data-ds-dark-theme');
        // `remote.account` 是可选服务：没有账户控制器的部署里插件照常工作，余额显示降级为「暂不可用」。
        const accountRef = { current: undefined };
        const balanceStore = createBalanceStore(ctx, accountRef);
        ctx.effect(() => ctx.inject(['remote.account'], (remoteCtx) => {
          let service;
          try {
            service = typeof remoteCtx.get === 'function' ? remoteCtx.get('remote.account') : undefined;
          } catch {}
          if (service === undefined) {
            try {
              service = remoteCtx.remote.account;
            } catch {}
          }
          accountRef.current = service;
          // 服务可能晚于首次渲染就绪：重置为待读取，让页面/角标重新触发读取。
          balanceStore.attachAccount();
          return () => {
            accountRef.current = undefined;
          };
        }), 'dsh-studio: account remote');
        // 余额自动更新：设置里的间隔变化时重建定时器；窗口隐藏时跳过，避免无意义请求。
        ctx.effect(() => {
          let timer;
          let activeMs = 0;
          const sync = () => {
            const state = settingsStore.get();
            const enabled = state.balanceIndicator === true;
            const ms = enabled && BALANCE_REFRESH_OPTIONS.includes(state.balanceRefreshMs)
              ? state.balanceRefreshMs
              : 0;
            if (timer !== undefined && activeMs === ms) return;
            if (timer !== undefined) {
              window.clearInterval(timer);
              timer = undefined;
            }
            activeMs = ms;
            if (ms > 0) {
              timer = window.setInterval(() => {
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                void balanceStore.load();
              }, ms);
            }
          };
          const unsubscribe = settingsStore.subscribe(sync);
          sync();
          return () => {
            unsubscribe();
            if (timer !== undefined) window.clearInterval(timer);
          };
        }, 'dsh-studio: balance auto refresh');
        // 启动时读取一次开关状态：左下角提示不必等页面打开就能出现。
        void settingsStore.load();
        // 主题皮肤：默认跟随 DSH；自定义皮肤通过 token 覆盖 + 侧栏海底等深线实现。
        ctx.effect(() => {
          const sync = () => applySkin(settingsStore.get().themeSkin);
          const unsubscribe = settingsStore.subscribe(sync);
          // 宿主切换浅/深色外观时重新同步：深色皮肤需要补回标记，默认/浅色皮肤需要让出标记。
          const offTheme = ctx.on('theme/change', (snapshot) => {
            hostColorSchemeDark = snapshot !== null && typeof snapshot === 'object' && snapshot.active !== undefined && snapshot.active.colorScheme === 'dark';
            sync();
          });
          sync();
          return () => {
            unsubscribe();
            offTheme();
            applySkin('default');
          };
        }, 'dsh-studio: theme skin');
        // Host 重启后补读一次设置；余额开关打开时顺带刷新余额。
        ctx.effect(() => ctx.on('connection/reset', () => {
          void settingsStore.load().then(() => {
            if (settingsStore.get().balanceIndicator === true) void balanceStore.load();
          });
        }), 'dsh-studio: settings reload');
        const Page = createPage(ctx, settingsStore, balanceStore);
        const FooterStatus = createFooterStatus(settingsStore, balanceStore);
        // 出错时的恢复入口：关掉两个左下角开关并重载，避免页面被错误兜底永久占据。
        const resetHints = async () => {
          try {
            await settingsStore.setSetting('pricingIndicator', false);
            await settingsStore.setSetting('balanceIndicator', false);
          } catch {}
          window.location.reload();
        };
        // 渲染兜底：出错时显示错误并写诊断日志，而不是整块白屏。
        const BoundedPage = withRenderBoundary('main', Page, { onReset: resetHints });
        const BoundedFooterStatus = withRenderBoundary('footer', FooterStatus, { compact: true });
        // 插槽级错误监督：即使兜底边界没接住（例如 inject 工厂或子组件崩溃），
        // 也把属于本插件的错误写进诊断日志。
        ctx.effect(() => {
          if (typeof ctx.slots.onEntryError !== 'function') return () => {};
          return ctx.slots.onEntryError((slot, entry, error) => {
            const options = entry !== null && typeof entry === 'object' ? (entry.options ?? entry) : undefined;
            const ours = slot === 'main'
              ? options?.key === PANEL_ID
              : slot === 'sidebar.footer.action'
                ? options?.id === 'studio.status'
                : slot === 'sidebar.panellist' ? options?.id === PANEL_ID : false;
            if (!ours) return;
            reportClientError(`slot:${slot}`, error);
          });
        }, 'dsh-studio: slot error reporter');
        // 兜底之外的运行时错误（副作用、未处理的 Promise）也写入诊断日志。
        ctx.effect(() => {
          const onError = (event) => reportClientError('window-error', event.error ?? event.message);
          const onRejection = (event) => reportClientError('unhandled-rejection', event.reason);
          window.addEventListener('error', onError);
          window.addEventListener('unhandledrejection', onRejection);
          return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
          };
        }, 'dsh-studio: client error reporters');

        // 中栏面板：与左侧栏入口使用同一个 id，供 selectPanel 切换。
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, BoundedPage),
        );

        // 左下角状态提示：位于账号（设置）上方，由工作台里的两个开关控制。
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'studio.status',
              order: 0,
              label: () => t('status.sectionTitle'),
              locale: NS,
            },
            BoundedFooterStatus,
          ),
        );

        // 左侧栏入口：中文显示「工作台」，英文显示 Harness Studio。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 5,
              label: () => t('panel'),
              locale: NS,
            },
            WorkstationIcon,
          ),
        );
      },
    };
  },
});
