
import { useState } from "react";
import { X, Loader2, Globe, CheckCircle } from "lucide-react";
import { SiteConfig } from "../App";

interface Props {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
}

type Step = 'input-url' | 'login' | 'fetching' | 'confirm';

/**
 * 站点编辑器组件
 * 负责新增/编辑站点的完整交互流程：输入URL→浏览器登录→获取信息→确认保存
 * - 新增模式：从输入URL开始，点击“下一步：浏览器登录”后打开Chrome供用户登录
 * - 登录完成：点击“已完成登录”后通过主进程获取用户ID、站点名称、access_token 等核心数据
 * - 确认保存：校验必要字段并将配置回传父组件保存
 */
export function SiteEditor({ site, onSave, onCancel }: Props) {
  // 编辑模式下直接跳到确认步骤，新增模式从输入URL开始
  const [step, setStep] = useState<Step>(site ? 'confirm' : 'input-url');
  const [url, setUrl] = useState(site?.url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false); // 控制令牌显示/隐藏
  const isEditing = !!site; // 判断是否为编辑模式
  const [importText, setImportText] = useState(""); // 控制台导入JSON文本
  const [importHint, setImportHint] = useState(""); // 导入结果提示
  const [copyHint, setCopyHint] = useState(""); // 复制脚本提示
  const [copyTargetHint, setCopyTargetHint] = useState(""); // 复制目标地址提示
  const [mode, setMode] = useState<'auto' | 'import'>('auto');
  const [urlError, setUrlError] = useState("");
  
  // 自动获取的信息
  const [autoInfo, setAutoInfo] = useState({
    name: site?.name || "",
    apiKey: site?.api_key || "",
    systemToken: site?.system_token || "",
    userId: site?.user_id || "",
    balance: null as number | null,
    extraLinks: site?.extra_links || "",  // 加油站链接
    enableCheckin: site?.force_enable_checkin || false,  // 启用签到功能
  });

  // 脱敏显示函数
  const maskToken = (token: string): string => {
    if (!token) return '';
    if (token.length <= 8) return '***';
    return `${token.substring(0, 3)}...${token.substring(token.length - 4)}`;
  };

  /**
   * URL合法性校验函数（严格）
   * 规则：必须能被URL解析，协议限定为http/https，必须包含主机名
   */
  const isValidUrlStrict = (value: string): boolean => {
    try {
      const u = new URL(value.trim());
      if (!u.protocol || !/^https?:$/.test(u.protocol)) return false;
      if (!u.hostname) return false;
      return true;
    } catch {
      return false;
    }
  };

  /**
   * URL自动补全与规范化
   * 策略：去空白、补全协议（默认https://）、去除多余空格
   */
  const normalizeUrl = (value: string): string => {
    let v = (value || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v;
  };

  /**
   * 处理URL输入变更：实时校验并提示错误
   */
  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (!value.trim()) {
      setUrlError("请输入URL");
      return;
    }
    const v = normalizeUrl(value);
    setUrlError(isValidUrlStrict(v) ? "" : "URL格式不合法，请输入形如 https://example.com 的地址");
  };


  /**
   * 手动执行自动补全（为未填写协议的域名补 https://）
   */
  const handleAutoCompleteUrl = () => {
    const v = normalizeUrl(url);
    setUrl(v);
    setUrlError(isValidUrlStrict(v) ? "" : "URL格式不合法，请检查");
  };

  /**
   * 处理“下一步：浏览器登录”点击事件
   * 职责：
   * 1. 校验并保存用户输入的站点 URL
   * 2. 通过预加载暴露的 API 启动 Chrome 浏览器并导航到该 URL
   * 3. 启动成功后切换到“浏览器登录”步骤，失败则展示错误
   */
  const handleUrlSubmit = async () => {
    if (!url.trim()) {
      setError("请输入站点URL");
      setUrlError("请输入URL");
      return;
    }

    const finalUrl = normalizeUrl(url);
    if (!isValidUrlStrict(finalUrl)) {
      setUrlError("URL格式不合法，请输入形如 https://example.com 的地址");
      return;
    }

    setUrl(finalUrl);

    setLoading(true);
    setError("");

    try {
      // 启动Chrome让用户登录
      const result = await window.electronAPI.launchChromeForLogin(finalUrl);
      
      if (result.success) {
        setStep('login');
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError("启动浏览器失败: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 处理“已完成登录”点击事件
   * 职责：
   * 1. 进入“获取信息”步骤并开启30秒超时保护
   * 2. 调用主进程 TokenService.initializeSite，优先从 localStorage 获取数据，必要时 API 回退
   * 3. 成功后填充自动信息（站点名、用户ID、access_token、签到能力等）进入“确认保存”步骤
   * 4. 失败时根据错误类型提供友好的中文提示并回退相应步骤
   */
  const handleLoginComplete = async () => {
    setStep('fetching');
    setLoading(true);
    setError("");

    // 添加超时保护
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), 30000); // 30秒超时
    });

    try {
      console.log('🚀 [SiteEditor] 使用新的TokenService.initializeSite()...');
      
      // 使用Promise.race实现超时控制
      const siteAccountResult = await Promise.race([
        (window.electronAPI as any).token.initializeSite(url),
        timeout
      ]) as any;
      
      console.log('📦 [SiteEditor] TokenService响应:', siteAccountResult);
      
      if (!siteAccountResult.success) {
        throw new Error(siteAccountResult.error || '初始化站点失败');
      }
      
      // TokenService.initializeSite() 返回完整的SiteAccount对象
      const siteAccount = siteAccountResult.data;
      console.log('✅ [SiteEditor] 成功初始化站点，数据:', siteAccount);
      
      const { 
        user_id, 
        username, 
        site_name, 
        access_token,
        supportsCheckIn
      } = siteAccount;
      
      console.log('✅ [SiteEditor] 解构后的数据:');
      console.log('   - 用户ID:', user_id);
      console.log('   - 用户名:', username);
      console.log('   - 站点名称:', site_name);
      console.log('   - 令牌长度:', access_token?.length || 0);
      console.log('   - 支持签到:', supportsCheckIn ?? '未知');
      
      if (!user_id) {
        throw new Error('初始化站点返回的数据中缺少用户ID');
      }
      
      const userId = user_id.toString();
      
      console.log('📊 [SiteEditor] 最终收集的信息:');
      console.log('   - 站点名称:', site_name);
      console.log('   - 用户ID:', userId);
      console.log('   - 令牌状态:', access_token ? '已获取' : '未获取');
      console.log('   - 签到功能:', supportsCheckIn ? '支持' : (supportsCheckIn === false ? '不支持' : '未知'));
      console.log('ℹ️ [SiteEditor] 首次添加站点，仅保存核心认证数据，余额将在刷新时获取');
      
      setAutoInfo({
        name: site_name || extractDomainName(url),
        apiKey: "", // API Key为可选
        systemToken: access_token || "",
        userId: userId,
        balance: null, // 首次添加不获取余额
        extraLinks: "",  // 加油站链接
        enableCheckin: supportsCheckIn === true,  // 如果检测到支持签到，默认启用
      });

      setStep('confirm');
    } catch (err: any) {
      console.error('❌ [SiteEditor] 获取站点信息失败:', err);
      
      // 根据错误类型提供不同的处理方式
      if (err.message === 'TIMEOUT') {
        setError("网络请求超时（30秒）。\n\n可能原因：\n1. 网络连接不稳定\n2. 站点响应过慢\n3. 防火墙阻止连接\n\n建议：检查网络连接后重试");
        setStep('input-url');
      } else if (err.message.includes('浏览器已关闭') || err.message.includes('操作已取消') || err.message.includes('操作已被取消')) {
        // 浏览器关闭错误 - 提示用户重新打开浏览器
        setError("⚠️ 检测到浏览器已关闭\n\n操作已自动取消。\n\n请重新点击'浏览器登录'按钮，在浏览器中完成登录后再继续。");
        setStep('input-url'); // 返回第一步，让用户重新开始
      } else if (err.message.includes('401') || err.message.includes('Cookie认证失败')) {
        setError("登录已过期，请关闭浏览器窗口，重新点击'浏览器登录'按钮");
        setStep('input-url'); // 返回第一步
      } else if (err.message.includes('手动生成Token') || err.message.includes('not valid JSON')) {
        // 站点需要在网页中手动生成Token
        setError("该站点需要在网页中手动生成Token。\n\n请在浏览器中：\n1. 找到并点击\"生成令牌\"或\"生成系统访问令牌\"按钮\n2. 返回应用，点击下方的\"重新获取\"按钮\n\n或者从浏览器Console中手动复制token填写。");
        setStep('confirm'); // 跳到确认页面，让用户选择
      } else if (err.message.includes('404') || err.message.includes('不支持')) {
        // 站点不支持自动创建Token，提供手动填写选项
        setError("该站点不支持自动获取Token。请手动填写access_token和user_id。");
        setStep('confirm'); // 跳到确认页面，让用户手动填写
      } else {
        setError("获取站点信息失败: " + err.message + "\n\n您可以选择手动填写信息。");
        setStep('confirm'); // 允许手动填写
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * 处理“控制台数据导入”操作
   * 职责：
   * 1. 解析用户从目标站点控制台复制的 JSON 文本
   * 2. 校验并提取必要字段（site_url/site_name/user_id/access_token）
   * 3. 更新当前编辑器的 url 与 autoInfo，跳转至“确认保存”步骤
   */
  const handleImportData = () => {
    try {
      setImportHint("");
      if (!importText.trim()) {
        setImportHint("请粘贴控制台输出的JSON数据");
        return;
      }
      const payload = JSON.parse(importText);

      const siteUrl: string = (payload.site_url || payload.base_url || payload.url || "").trim();
      const siteName: string = (payload.site_name || payload.system_name || "").trim();
      const userIdRaw = payload.user_id ?? payload.uid ?? payload.id;
      const token: string = (payload.access_token || payload.token || payload.auth_token || "").trim();

      if (!siteUrl) {
        setImportHint("缺少 site_url 字段");
        return;
      }
      if (!userIdRaw) {
        setImportHint("缺少 user_id 字段");
        return;
      }
      if (!token) {
        setImportHint("缺少 access_token 字段");
        return;
      }

      const userId = String(userIdRaw);
      setUrl(siteUrl);
      setAutoInfo({
        name: siteName || extractDomainName(siteUrl),
        apiKey: "",
        systemToken: token,
        userId,
        balance: null,
        extraLinks: "",
        enableCheckin: payload.supportsCheckIn === true
      });
      setStep('confirm');
      setImportHint("✅ 已导入数据，请在下方确认后保存");
    } catch (e: any) {
      setImportHint("JSON解析失败：" + (e.message || String(e)));
    }
  };

  /**
   * 生成控制台脚本文本
   * 职责：提供一段可在目标站点控制台执行的JS，输出统一JSON
   */
  const getConsoleScript = (): string => {
    return `(
  async () => {
    const origin = location.origin.replace(/\/$/, '');

    const parseJSON = (str) => { try { return JSON.parse(str); } catch { return null; } };
    const pick = (obj, keys) => keys.reduce((v, k) => v ?? obj?.[k], undefined);

    const scanStoresForToken = (stores) => {
      let token = null;
      for (const store of stores) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const val = store.getItem(key);
          if (!val) continue;
          const obj = parseJSON(val);
          if (obj && typeof obj === 'object') {
            const ks = ['access_token','accessToken','token','auth_token','authToken','api_token','bearer_token'];
            for (const k of ks) {
              const v = obj[k];
              if (typeof v === 'string' && v.length > 15) { token = token || v; }
            }
          } else if (typeof val === 'string') {
            const m = val.match(/[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/);
            if (m && m[0] && m[0].length > 30) { token = token || m[0]; }
          }
        }
      }
      return token;
    };

    const readCookieToken = () => {
      const map = {};
      document.cookie.split(';').forEach(p => {
        const [k, ...rest] = p.split('=');
        if (!k) return;
        map[k.trim()] = rest.join('=').trim();
      });
      const ks = ['access_token','token','auth_token','api_token','bearer_token'];
      for (const k of ks) { const v = map[k]; if (v && v.length > 15) return v; }
      for (const k of Object.keys(map)) {
        const v = map[k];
        const m = v && v.match(/Bearer\s+([^;\s]+)/i);
        if (m && m[1]) return m[1];
      }
      return null;
    };

    const readLocal = () => {
      const s = window.localStorage;
      const ss = window.sessionStorage;

      const user = parseJSON(s.getItem('user'));
      const siteInfo = parseJSON(s.getItem('siteInfo'));
      const userInfo = parseJSON(s.getItem('userInfo'));
      const config = parseJSON(s.getItem('config') || s.getItem('siteConfig'));
      const status = parseJSON(s.getItem('status') || s.getItem('siteStatus'));
      const checkIn = parseJSON(s.getItem('checkIn') || s.getItem('check_in'));

      const user_id = (
        pick(user, ['id','user_id','userId','uid','user_ID']) ??
        pick(siteInfo, ['id','user_id','userId','uid']) ??
        pick(userInfo, ['id','user_id','userId']) ??
        (s.getItem('user_id') || s.getItem('userId') || s.getItem('uid') || s.getItem('id'))
      );

      const username = (
        pick(user, ['username','name','display_name','displayName','nickname','login']) ??
        pick(siteInfo, ['username','name','display_name','user_name']) ??
        pick(userInfo, ['username','name']) ??
        (s.getItem('username') || s.getItem('user_name') || s.getItem('nickname'))
      );

      const system_name = (
        pick(siteInfo, ['system_name','systemName','site_name','siteName','name']) ??
        pick(config, ['system_name','systemName','site_name','name']) ??
        (s.getItem('system_name') || s.getItem('systemName') || s.getItem('site_name') || s.getItem('siteName') || s.getItem('app_name'))
      );

      const tokenFromKnown = (
        pick(user, ['access_token','accessToken','token','auth_token','authToken','api_token','bearer_token']) ??
        pick(siteInfo, ['access_token','accessToken','token']) ??
        (parseJSON(s.getItem('auth') || s.getItem('authentication'))?.access_token) ??
        (s.getItem('access_token') || s.getItem('accessToken') || s.getItem('token') || s.getItem('auth_token') || s.getItem('authToken') || s.getItem('api_token') || s.getItem('apiToken') || s.getItem('bearer_token'))
      );
      const tokenFromScan = scanStoresForToken([s, ss]);
      const tokenFromCookie = readCookieToken();
      const access_token = tokenFromKnown || tokenFromScan || tokenFromCookie || null;

      const supportsCheckIn = siteInfo?.check_in_enabled ?? status?.check_in_enabled ?? checkIn?.enabled ?? null;
      const canCheckIn = user?.can_check_in ?? checkIn?.can_check_in ?? null;

      return { user_id, username, system_name, access_token, supportsCheckIn, canCheckIn };
    };

    const getJSON = async (url) => {
      const resp = await fetch(url, { method: 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } });
      const text = await resp.text();
      if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`);
      if (text.includes('<!DOCTYPE')) throw new Error('被拦截或挑战页面');
      try { return JSON.parse(text); } catch { throw new Error('not valid JSON'); }
    };

    const readViaApi = async () => {
      const candidates = ['/api/user/self', '/api/user/dashboard', '/api/user'];
      let user = {};
      for (const p of candidates) {
        try {
          const data = await getJSON(origin + p);
          const u = data?.data ?? data;
          if (u?.id || u?.user_id) {
            user.user_id = u.id ?? u.user_id ?? u.userId ?? u.uid ?? u.user_ID;
            user.username = u.username ?? u.name ?? u.display_name ?? u.displayName ?? u.nickname ?? u.login ?? u.user_name;
            user.access_token = u.access_token ?? u.accessToken ?? u.token ?? u.auth_token ?? u.authToken ?? u.api_token ?? u.bearer_token;
            break;
          }
        } catch (e) { /* ignore */ }
      }
      let system_name = null;
      try {
        const s = await getJSON(origin + '/api/status');
        system_name = s?.data?.system_name ?? s?.data?.systemName ?? s?.data?.site_name ?? s?.data?.name ?? s?.system_name ?? s?.systemName ?? null;
      } catch (e) { /* ignore */ }
      return { ...user, system_name };
    };

    // 获取 API Keys（令牌回退），兼容多返回结构并打印日志
    const fetchApiKeys = async (user_id) => {
      if (!user_id) return [];
      const headers = {
        'Content-Type': 'application/json',
        'New-API-User': String(user_id),
        'Veloera-User': String(user_id),
        'voapi-user': String(user_id),
        'User-id': String(user_id),
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache'
      };
      const urls = [
        origin + '/api/token/?page=1&size=100&keyword=&order=-id',
        origin + '/api/token/?p=1&size=100',
        origin + '/api/token/?p=0&size=100',
        origin + '/api/token/'
      ];
      for (const url of urls) {
        try {
          console.log('[ConsoleScript] GET', url);
          const resp = await fetch(url, { method: 'GET', credentials: 'include', headers });
          const text = await resp.text();
          if (!resp.ok) { console.log('[ConsoleScript] HTTP', resp.status, text.slice(0,120)); continue; }
          if (text.includes('<!DOCTYPE')) { console.log('[ConsoleScript] HTML intercepted'); continue; }
          const data = JSON.parse(text);
          let items = [];
          if (Array.isArray(data)) items = data;
          else if (Array.isArray(data?.data)) items = data.data;
          else if (Array.isArray(data?.data?.items)) items = data.data.items;
          else if (Array.isArray(data?.items)) items = data.items;
          if (items.length > 0) {
            console.log('[ConsoleScript] Tokens count:', items.length);
            return items;
          }
        } catch (err) {
          console.log('[ConsoleScript] fetchApiKeys error:', err?.message || String(err));
          continue;
        }
      }
      return [];
    };

    const createTokenIfMissing = async (user_id) => {
      if (!user_id) return null;
      const headers = {
        'Content-Type': 'application/json',
        'New-API-User': String(user_id),
        'Veloera-User': String(user_id),
        'voapi-user': String(user_id),
        'User-id': String(user_id),
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache'
      };
      try {
        const resp = await fetch(origin + '/api/user/token', { method: 'GET', credentials: 'include', headers });
        const text = await resp.text();
        if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`);
        const data = JSON.parse(text);
        if (typeof data === 'string' && data.length > 10) return data;
        if (data?.data && typeof data.data === 'string') return data.data;
        if (data?.token && typeof data.token === 'string') return data.token;
        if (data?.data?.token && typeof data.data.token === 'string') return data.data.token;
        throw new Error(data?.message || '创建令牌失败');
      } catch (e) { return null; }
    };

    const local = readLocal();
    const api = (!local.user_id || !local.access_token) ? await readViaApi() : {};
    const merged = { ...local, ...api };
    if (!merged.access_token) {
      console.log('[ConsoleScript] access_token missing, try /api/user/token');
      merged.access_token = await createTokenIfMissing(merged.user_id);
    }
    let api_key = null;
    if (!merged.access_token) {
      console.log('[ConsoleScript] token creation failed, try /api/token list');
      const keys = await fetchApiKeys(merged.user_id);
      if (Array.isArray(keys) && keys.length > 0) {
        api_key = keys[0]?.key || null;
        merged.access_token = api_key || merged.access_token;
        console.log('[ConsoleScript] fallback api_key selected:', api_key ? (api_key.slice(0,4)+'...') : 'none');
      }
    }

    const payload = {
      site_url: origin,
      site_name: merged.system_name || new URL(origin).hostname,
      user_id: merged.user_id,
      username: merged.username || null,
      access_token: merged.access_token,
      supportsCheckIn: merged.supportsCheckIn ?? null,
      canCheckIn: merged.canCheckIn ?? null
    };
    if (api_key) payload.api_key = api_key;

    const out = JSON.stringify(payload);
    console.log('控制台导出JSON如下，复制并粘贴到应用：');
    console.log(out);
    try { await navigator.clipboard.writeText(out); console.log('已复制到剪贴板'); } catch {}
  }
)();`;
  };

  /**
   * 计算推荐的控制台页面URL（中文注释）
   * 职责：对当前 URL 进行规范化与严格校验，合法时返回 origin+'/console/token'，否则返回空字符串
   */
  const getTargetConsoleUrl = (): string => {
    const v = normalizeUrl(url);
    if (!isValidUrlStrict(v)) return '';
    try {
      const u = new URL(v);
      return `${u.origin}/console/token`;
    } catch {
      return '';
    }
  };

  /**
   * 处理“复制目标地址”点击事件（中文注释）
   * 职责：基于合法URL生成推荐链接，写入剪贴板并提示结果
   */
  const handleCopyTargetUrl = async () => {
    const v = normalizeUrl(url);
    if (!isValidUrlStrict(v)) {
      setCopyTargetHint('请先填写有效的站点URL');
      setTimeout(() => setCopyTargetHint(''), 4000);
      return;
    }
    const target = getTargetConsoleUrl();
    try {
      await navigator.clipboard.writeText(target);
      setCopyTargetHint('✅ 已复制目标地址');
      setTimeout(() => setCopyTargetHint(''), 4000);
    } catch (e: any) {
      setCopyTargetHint('复制失败：' + (e?.message || String(e)));
      setTimeout(() => setCopyTargetHint(''), 5000);
    }
  };

  /**
   * 处理“打开登录页”点击事件（中文注释）
   * 职责：根据合法URL生成推荐链接，通过主进程打开页面
   */
  const handleOpenTargetUrl = async () => {
    const v = normalizeUrl(url);
    if (!isValidUrlStrict(v)) {
      setCopyTargetHint('请先填写有效的站点URL');
      setTimeout(() => setCopyTargetHint(''), 4000);
      return;
    }
    const target = getTargetConsoleUrl();
    try {
      const result = await (window as any).electronAPI.launchChromeForLogin(target);
      if (!result?.success) {
        setCopyTargetHint(result?.message || '打开浏览器失败');
        setTimeout(() => setCopyTargetHint(''), 5000);
      }
    } catch (e: any) {
      setCopyTargetHint('打开失败：' + (e?.message || String(e)));
      setTimeout(() => setCopyTargetHint(''), 5000);
    }
  };

  /**
   * 生成兼容性的控制台脚本（ES5语法、无模板字符串/箭头函数）
   * 用于修复某些浏览器控制台粘贴执行时出现的 Unexpected token 错误
   */
  const getSafeConsoleScript = (): string => {
    const lines = [
      '(function(){',
      'var origin=location.origin.replace(/\\\/$/, "");',
      'function parseJSON(str){try{return JSON.parse(str)}catch(e){return null}}',
      'function pick(obj,keys){var v=null;for(var i=0;i<keys.length;i++){var k=keys[i];if(obj&&obj[k]!=null){if(v===null){v=obj[k]}}}return v}',
      'function scanStoresForToken(stores){var token=null;for(var si=0;si<stores.length;si++){var store=stores[si];for(var i=0;i<store.length;i++){var key=store.key(i);var val=store.getItem(key);if(!val)continue;var obj=parseJSON(val);if(obj&&typeof obj==="object"){var ks=["access_token","accessToken","token","auth_token","authToken","api_token","bearer_token"];for(var j=0;j<ks.length;j++){var v=obj[ks[j]];if(typeof v==="string"&&v.length>15){token=token||v}}}else if(typeof val==="string"){var m=val.match(/[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+/);if(m&&m[0]&&m[0].length>30){token=token||m[0]}}}}return token}',
      'function readCookieToken(){var map={};var parts=document.cookie.split(";");for(var i=0;i<parts.length;i++){var p=parts[i];var seg=p.split("=");var k=seg[0];var rest=seg.slice(1).join("=");if(!k)continue;map[k.trim()]=rest.trim()}var ks=["access_token","token","auth_token","api_token","bearer_token"];for(var j=0;j<ks.length;j++){var v=map[ks[j]];if(v&&v.length>15)return v}for(var k in map){var v=map[k];var m=v&&v.match(/Bearer\s+([^;\s]+)/i);if(m&&m[1])return m[1]}return null}',
      'function getJSON(url,headers){return fetch(url,{method:"GET",credentials:"include",headers:headers}).then(function(resp){return resp.text().then(function(text){if(!resp.ok)throw new Error("HTTP "+resp.status);if(text.indexOf("<!DOCTYPE")>=0)throw new Error("HTML");try{return JSON.parse(text)}catch(e){throw new Error("not valid JSON")}})})}',
      'function readLocal(){var s=window.localStorage;var ss=window.sessionStorage;var user=parseJSON(s.getItem("user"));var siteInfo=parseJSON(s.getItem("siteInfo"));var userInfo=parseJSON(s.getItem("userInfo"));var config=parseJSON(s.getItem("config")||s.getItem("siteConfig"));var status=parseJSON(s.getItem("status")||s.getItem("siteStatus"));var checkIn=parseJSON(s.getItem("checkIn")||s.getItem("check_in"));var uid=null;uid=pick(user,["id","user_id","userId","uid","user_ID"])||pick(siteInfo,["id","user_id","userId","uid"])||pick(userInfo,["id","user_id","userId"]);if(uid==null){var idStr=s.getItem("user_id")||s.getItem("userId")||s.getItem("uid")||s.getItem("id");if(idStr){var p=parseInt(idStr,10);if(!isNaN(p))uid=p}}var username=pick(user,["username","name","display_name","displayName","nickname","login"])||pick(siteInfo,["username","name","display_name","user_name"])||pick(userInfo,["username","name"])||s.getItem("username")||s.getItem("user_name")||s.getItem("nickname");var system_name=pick(siteInfo,["system_name","systemName","site_name","siteName","name"])||pick(config,["system_name","systemName","site_name","name"])||s.getItem("system_name")||s.getItem("systemName")||s.getItem("site_name")||s.getItem("siteName")||s.getItem("app_name");var tokenKnown=pick(user,["access_token","accessToken","token","auth_token","authToken","api_token","bearer_token"])||pick(siteInfo,["access_token","accessToken","token"])||((parseJSON(s.getItem("auth")||s.getItem("authentication"))||{}).access_token)||s.getItem("access_token")||s.getItem("accessToken")||s.getItem("token")||s.getItem("auth_token")||s.getItem("authToken")||s.getItem("api_token")||s.getItem("apiToken")||s.getItem("bearer_token");var tokenScan=scanStoresForToken([s,ss]);var tokenCookie=readCookieToken();var access_token=tokenKnown||tokenScan||tokenCookie||null;var supportsCheckIn=(siteInfo&&siteInfo.check_in_enabled!=null)?siteInfo.check_in_enabled:((status&&status.check_in_enabled!=null)?status.check_in_enabled:null);var canCheckIn=(user&&user.can_check_in!=null)?user.can_check_in:((checkIn&&checkIn.can_check_in!=null)?checkIn.can_check_in:null);return {user_id:uid,username:username,system_name:system_name,access_token:access_token,supportsCheckIn:supportsCheckIn,canCheckIn:canCheckIn}}',
      'function readViaApi(origin){var bases=[origin,origin+"/console"];var candidates=["/api/user/self","/api/user/dashboard","/api/user"];var user={};var bi=0;var ci=0;function nextBase(){ci=0;if(bi>=bases.length)return Promise.resolve(user);return nextPath()}function nextPath(){if(ci>=candidates.length){bi++;return nextBase()}var base=bases[bi];var p=candidates[ci++];return getJSON(base+p,{}).then(function(data){var u=(data&&data.data)?data.data:data;if(u&&(u.id!=null||u.user_id!=null)){user.user_id=u.id||u.user_id||u.userId||u.uid||u.user_ID;user.username=u.username||u.name||u.display_name||u.displayName||u.nickname||u.login||u.user_name;user.access_token=u.access_token||u.accessToken||u.token||u.auth_token||u.authToken||u.api_token||u.bearer_token;return user}return nextPath()}).catch(function(){return nextPath()})}return nextBase().then(function(){var base=bases[0];return getJSON(base+"/api/status",{}).then(function(s){var name=null;if(s&&s.data){name=s.data.system_name||s.data.systemName||s.data.site_name||s.data.name}user.system_name=name;return user}).catch(function(){return user})})}',
      'function createTokenIfMissing(origin,uid){if(!uid)return Promise.resolve(null);var headers={"Content-Type":"application/json","New-API-User":String(uid),"Veloera-User":String(uid),"voapi-user":String(uid),"User-id":String(uid),"Cache-Control":"no-store","Pragma":"no-cache"};var bases=[origin,origin+"/console"];var i=0;function next(){if(i>=bases.length)return Promise.resolve(null);var base=bases[i++];return fetch(base+"/api/user/token",{method:"GET",credentials:"include",headers:headers}).then(function(resp){return resp.text().then(function(text){if(!resp.ok)throw new Error("HTTP "+resp.status);var data=parseJSON(text);if(typeof data==="string"&&data.length>10)return data;if(data&&typeof data.data==="string")return data.data;if(data&&typeof data.token==="string")return data.token;if(data&&data.data&&typeof data.data.token==="string")return data.data.token;throw new Error((data&&data.message)||"创建令牌失败")})}).catch(function(){return next()})}return next()}',
      'function fetchApiKeys(origin,uid){if(!uid)return Promise.resolve([]);var headers={"Content-Type":"application/json","New-API-User":String(uid),"Veloera-User":String(uid),"voapi-user":String(uid),"User-id":String(uid),"Cache-Control":"no-store","Pragma":"no-cache"};var bases=[origin,origin+"/console"];var bi=0;var ui=0;var urls=[];function build(){urls=[bases[bi]+"/api/token/?page=1&size=100&keyword=&order=-id",bases[bi]+"/api/token/?p=1&size=100",bases[bi]+"/api/token/?p=0&size=100",bases[bi]+"/api/token/"]}build();function next(){if(ui>=urls.length){bi++;ui=0;if(bi>=bases.length)return Promise.resolve([]);build()}var url=urls[ui++];console.log("[ConsoleScript] GET",url);return fetch(url,{method:"GET",credentials:"include",headers:headers}).then(function(resp){return resp.text().then(function(text){if(!resp.ok){console.log("[ConsoleScript] HTTP",resp.status,text.slice(0,120));return next()}if(text.indexOf("<!DOCTYPE")>=0){console.log("[ConsoleScript] HTML intercepted");return next()}var data=parseJSON(text)||{};var items=[];if(Array.isArray(data))items=data;else if(Array.isArray(data.data))items=data.data;else if(data.data&&Array.isArray(data.data.items))items=data.data.items;else if(Array.isArray(data.items))items=data.items;if(items.length>0){console.log("[ConsoleScript] Tokens count:",items.length);return items}return next()})}).catch(function(err){console.log("[ConsoleScript] fetchApiKeys error:",err&&err.message?err.message:String(err));return next()})}return next()}',
      'var local=readLocal();',
      'readViaApi(origin).then(function(api){var merged={};for(var k in local){merged[k]=local[k]}for(var k2 in api){merged[k2]=api[k2]}if(!merged.access_token){console.log("[ConsoleScript] access_token missing, try /api/user/token");return createTokenIfMissing(origin,merged.user_id).then(function(tok){merged.access_token=tok;return merged})}return merged}).then(function(merged){if(merged.access_token){return Promise.resolve({merged:merged,apiKey:null})}console.log("[ConsoleScript] token creation failed, try /api/token list");return fetchApiKeys(origin,merged.user_id).then(function(items){var key=null;if(Array.isArray(items)&&items.length>0){key=items[0]&&items[0].key?items[0].key:null;merged.access_token=key||merged.access_token;console.log("[ConsoleScript] fallback api_key selected:",key?key.slice(0,4)+"...":"none")}return {merged:merged,apiKey:key}})}).then(function(res){var merged=res.merged;var apiKey=res.apiKey;var payload={site_url:origin.replace(/[`]/g,\'\').trim(),site_name:(merged.system_name||new URL(origin).hostname),user_id:merged.user_id,username:(merged.username||null),access_token:merged.access_token,supportsCheckIn:(merged.supportsCheckIn!=null?merged.supportsCheckIn:null),canCheckIn:(merged.canCheckIn!=null?merged.canCheckIn:null)};if(apiKey)payload.api_key=apiKey;var out=JSON.stringify(payload);console.log("控制台导出JSON如下，复制并粘贴到应用：");console.log(out);if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(out).then(function(){console.log("已复制到剪贴板")}).catch(function(){})}}).catch(function(err){console.log("[ConsoleScript] fatal:",err&&err.message?err.message:String(err))})',
      '})();'
    ];
    return lines.join('\n');
  };

  /**
   * 生成最小化控制台脚本（仅站点令牌 + API Keys + 状态）
   */
  const getMinimalConsoleScript = (): string => {
    const s = [
      '(function(){',
      'var origin=(new URL(location.href)).origin;',
      'function parseJSON(str){try{return JSON.parse(str)}catch(e){return null}}',
      'function pick(obj,keys){var v=null;for(var i=0;i<keys.length;i++){var k=keys[i];if(obj&&obj[k]!=null){if(v===null){v=obj[k]}}}return v}',
      'function tryFetch(url,headers){return fetch(url,{method:"GET",credentials:"include",headers:headers}).then(function(resp){return resp.text().then(function(text){if(!resp.ok)throw new Error("HTTP "+resp.status+" "+text.slice(0,120));if(text.indexOf("<!DOCTYPE")>=0)throw new Error("HTML "+text.slice(0,120));var data=parseJSON(text);if(!data)throw new Error("not valid JSON");return data})})}',
      'function getSiteToken(uid){var headers={"accept":"application/json, text/plain, */*","referer":origin+"/console/token","new-api-user":String(uid),"veloera-user":String(uid),"voapi-user":String(uid),"user-id":String(uid),"cache-control":"no-store","pragma":"no-cache"};var bases=[origin,origin+"/console"];var i=0;function next(){if(i>=bases.length)return Promise.resolve(null);var base=bases[i++];return tryFetch(base+"/api/user/token",headers).then(function(data){if(typeof data==="string")return data;if(data&&typeof data.data==="string")return data.data;if(data&&typeof data.token==="string")return data.token;if(data&&data.data&&typeof data.data.token==="string")return data.data.token;return null}).catch(function(){return next()})}return next()}',
      'function getApiKeys(uid){var headers={"accept":"application/json, text/plain, */*","referer":origin+"/console/token","new-api-user":String(uid),"cache-control":"no-store","pragma":"no-cache"};var bases=[origin,origin+"/console"];var urls=[];for(var b=0;b<bases.length;b++){var base=bases[b];urls.push(base+"/api/token/?page=1&size=100&keyword=&order=-id");urls.push(base+"/api/token/?p=1&size=100");urls.push(base+"/api/token/?p=0&size=100");urls.push(base+"/api/token/")}var i=0;function next(){if(i>=urls.length)return Promise.resolve([]);var url=urls[i++];return tryFetch(url,headers).then(function(data){var items=Array.isArray(data)?data:(Array.isArray(data&&data.data)?data.data:(Array.isArray(data&&data.data&&data.data.items)?data.data.items:(Array.isArray(data&&data.items)?data.items:[])));if(items.length>0)return items;return next()}).catch(function(){return next()})}return next()}',
      'function getStatus(){var bases=[origin,origin+"/console"];var i=0;function next(){if(i>=bases.length)return Promise.resolve(null);var base=bases[i++];return tryFetch(base+"/api/status",{}).then(function(s){var name=null;if(s&&s.data){name=s.data.system_name||s.data.systemName||s.data.site_name||s.data.name}return name}).catch(function(){return next()})}return next()}',
      'var ls=window.localStorage;var user=parseJSON(ls.getItem("user"));var uid=user&&user.id?user.id:(user&&user.user_id?user.user_id:(ls.getItem("user_id")||ls.getItem("userId")));',
      'if(!uid){console.log("未发现 user_id，请先进入控制台用户页或手动填写");return}',
      'Promise.all([getSiteToken(uid),getApiKeys(uid),getStatus()]).then(function(arr){var siteToken=arr[0];var keys=arr[1]||[];var apiKey=keys.length?keys[0].key:null;var siteName=arr[2]||"";var payload={site_url:origin.replace(/[`]/g,"").trim(),site_name:siteName||new URL(origin).hostname,user_id:Number(uid),username:(user&&user.username)||user&&user.name||null,access_token:siteToken||apiKey||null,api_key:apiKey||null};var out=JSON.stringify(payload);console.log("控制台导出JSON如下，复制到应用：");console.log(out);if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(out).then(function(){console.log("已复制到剪贴板")}).catch(function(){})}}).catch(function(e){console.log("[MinimalScript] fatal:",e&&e.message?e.message:String(e))})',
      '})();'
    ];
    return s.join('\n');
  };

  /**
   * 处理“复制控制台脚本”点击事件
   * 职责：将控制台脚本写入剪贴板，便于在目标站点页面直接粘贴执行
   */
  const handleCopyConsoleScript = async () => {
    try {
      await navigator.clipboard.writeText(getMinimalConsoleScript());
      setCopyHint('✅ 控制台脚本已复制，请到目标站点控制台粘贴执行');
      setTimeout(() => setCopyHint(''), 5000);
    } catch (e: any) {
      setCopyHint('复制失败：' + (e?.message || String(e)));
      setTimeout(() => setCopyHint(''), 5000);
    }
  };

  void getSafeConsoleScript;
  void (typeof (globalThis as any).getConsoleScript !== 'undefined' && (globalThis as any).getConsoleScript);

  /**
   * 从URL中提取站点名称
   * 优先使用域名主要部分，去除常见的www前缀和TLD后缀
   */
  /**
   * 从站点 URL 提取站点名称
   * 策略：去除 www 前缀，优先取主域名部分（支持二级/三级域名），异常时返回“新站点”
   */
  const extractDomainName = (url: string): string => {
    try {
      const urlObj = new URL(url);
      let hostname = urlObj.hostname.replace('www.', '');
      
      // 尝试提取主域名（去除TLD）
      // 例如：api.example.com -> example
      //      tbai.xin -> tbai
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        // 如果是三级域名（如 api.example.com），取倒数第二部分
        // 如果是二级域名（如 tbai.xin），取第一部分
        return parts.length > 2 ? parts[parts.length - 2] : parts[0];
      }
      
      return hostname;
    } catch {
      return "新站点";
    }
  };

  /**
   * 处理“保存站点”点击事件
   * 职责：
   * 1. 组装用户确认后的站点配置（必要字段：name/url/user_id/system_token）
   * 2. 通过 onSave 回传父组件触发持久化与后续刷新
   */
  const handleSave = () => {
    // 1. 构建站点配置
    const newSite: SiteConfig = {
      name: autoInfo.name || extractDomainName(url),
      url: url.trim(),
      api_key: autoInfo.apiKey,
      system_token: autoInfo.systemToken,
      user_id: autoInfo.userId,
      enabled: true,
      has_checkin: false,
      extra_links: autoInfo.extraLinks,  // 加油站链接
      force_enable_checkin: autoInfo.enableCheckin,  // 用户勾选的签到功能
    };

    // 2. 保存站点并关闭对话框
    console.log('💾 [SiteEditor] 保存站点配置并关闭对话框');
    onSave(newSite);
    // onSave 会触发 App.tsx 的回调，关闭对话框并触发刷新
  };

  /**
   * 处理“导入并保存”点击事件
   * 职责：解析控制台JSON，直接保存站点，不进入自动识别向导
   */
  const handleImportSave = () => {
    try {
      setImportHint("");
      if (!importText.trim()) {
        setImportHint("请粘贴控制台输出的JSON数据");
        return;
      }
      const payload = JSON.parse(importText);
      const siteUrl: string = (payload.site_url || payload.base_url || payload.url || "").trim();
      const siteName: string = (payload.site_name || payload.system_name || "").trim();
      const userIdRaw = payload.user_id ?? payload.uid ?? payload.id;
      const token: string = (payload.access_token || payload.token || payload.auth_token || "").trim();
      const apiKey: string = (payload.api_key || "").trim();
      if (!siteUrl) { setImportHint("缺少 site_url 字段"); return; }
      if (!userIdRaw) { setImportHint("缺少 user_id 字段"); return; }
      if (!token && !apiKey) { setImportHint("缺少访问令牌或API Key"); return; }
      const newSite: SiteConfig = {
        name: siteName || extractDomainName(siteUrl),
        url: siteUrl,
        api_key: apiKey || '',
        system_token: token || undefined,
        user_id: String(userIdRaw),
        enabled: true,
        has_checkin: false,
        extra_links: "",
        force_enable_checkin: false,
      };
      onSave(newSite);
      setImportHint("✅ 已导入并保存站点");
    } catch (e: any) {
      setImportHint("JSON解析失败：" + (e.message || String(e)));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-light-card dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl md:max-w-3xl border border-slate-200 dark:border-slate-700 max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-light-card dark:bg-dark-card">
          <h2 className="text-xl font-bold">
            {site ? "编辑站点" : "智能添加站点"}
          </h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-6 space-y-6 overflow-y-auto scroll-smooth">
          {/* 添加方式切换 */}
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${mode==='auto' ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}
              onClick={() => setMode('auto')}
            >
              自动识别
            </button>
            <button
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${mode==='import' ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}
              onClick={() => setMode('import')}
            >
              控制台导入
            </button>
          </div>
          {/* 步骤指示器（仅自动识别模式显示） */}
          {mode==='auto' && (
          <div className="flex items-center justify-between">
            {[
              { id: 'input-url', label: '输入URL', icon: '1' },
              { id: 'login', label: '浏览器登录', icon: '2' },
              { id: 'fetching', label: '获取信息', icon: '3' },
              { id: 'confirm', label: '确认保存', icon: '4' },
            ].map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className={`flex items-center gap-2 ${
                  step === s.id ? 'text-primary-600 dark:text-primary-400' : 
                  ['login', 'fetching', 'confirm'].indexOf(s.id) <= ['login', 'fetching', 'confirm'].indexOf(step as any) ? 
                  'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'
                }`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-base text-white shadow-md ${
                    step === s.id ? 'bg-primary-500' :
                    ['login', 'fetching', 'confirm'].indexOf(s.id) <= ['login', 'fetching', 'confirm'].indexOf(step as any) ?
                    'bg-green-500' : 'bg-slate-400 dark:bg-slate-600'
                  }`}>
                    {s.icon}
                  </div>
                  <span className="text-sm font-semibold">{s.label}</span>
                </div>
                {idx < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${
                    ['login', 'fetching', 'confirm'].indexOf(['input-url', 'login', 'fetching', 'confirm'][idx + 1]) <= ['login', 'fetching', 'confirm'].indexOf(step as any) ?
                    'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`} />
                )}
              </div>
            ))}
          </div>
          )}

          {/* 控制台导入（独立入口，脱离自动识别流程） */}
          {mode==='import' && (
            <div className="px-4 py-3 bg-light-bg-secondary dark:bg-dark-bg-secondary border-2 border-light-border dark:border-dark-border rounded-lg text-sm space-y-2 mt-4 text-light-text dark:text-dark-text">
              <div className="font-semibold text-green-700 dark:text-green-300">🧩 控制台数据导入（无需自动化）</div>
              <div className="text-xs text-green-700/80 dark:text-green-300/80">
                在目标站点登录后，点击“复制控制台脚本”，到推荐页面控制台粘贴执行；复制输出的JSON到文本框并点击导入。
              </div>
              {/* 导入流程专用URL输入 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-light-text dark:text-dark-text">目标站点URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    onBlur={handleAutoCompleteUrl}
                    placeholder="https://api.example.com"
                    className="flex-1 px-3 py-2 bg-light-card dark:bg-dark-bg border-2 border-light-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-light-text dark:text-dark-text placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
                {urlError && (
                  <div className="px-3 py-2 bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-600 rounded-lg text-red-700 dark:text-red-300 text-xs">
                    {urlError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-700 dark:text-slate-300">推荐页面：</span>
                {getTargetConsoleUrl() ? (
                  <a href={getTargetConsoleUrl()} target="_blank" rel="noreferrer" className="underline text-blue-600 dark:text-blue-400">
                    {getTargetConsoleUrl()}
                  </a>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">请先填写站点URL</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyTargetUrl}
                  disabled={!getTargetConsoleUrl()}
                  className="px-3 py-2 border-2 border-primary-200 dark:border-primary-400/40 bg-transparent text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm"
                >
                  复制目标地址
                </button>
                <button
                  onClick={handleOpenTargetUrl}
                  disabled={!getTargetConsoleUrl()}
                  className="px-3 py-2 border-2 border-primary-200 dark:border-primary-400/40 bg-transparent text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm"
                >
                  打开登录页
                </button>
                {copyTargetHint && (
                  <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{copyTargetHint}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyConsoleScript}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold"
                >
                  复制控制台脚本
                </button>
                {copyHint && (
                  <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{copyHint}</span>
                )}
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"site_url":"https://example.com","site_name":"MySite","user_id":123,"access_token":"..."}'
                className="w-full mt-2 px-3 py-2 bg-light-card dark:bg-dark-card border-2 border-light-border dark:border-dark-border rounded text-xs font-mono"
                rows={4}
              />
              {importHint && (
                <div className="text-xs font-medium text-green-700 dark:text-green-300">{importHint}</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleImportSave}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold"
                >
                  导入并保存
                </button>
              </div>
            </div>
          )}

          {/* 步骤1: 输入URL */}
          {mode==='auto' && step === 'input-url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
                  站点URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-4 py-3 bg-white dark:bg-dark-bg border-2 border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-light-text dark:text-dark-text placeholder-slate-400 dark:placeholder-slate-500"
                />
                <p className="mt-2 text-xs text-light-text-secondary dark:text-dark-text-secondary">
                  输入API站点的完整URL，例如：https://tbai.xin
                </p>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-600 rounded-lg text-red-700 dark:text-red-300 text-sm font-medium">
                  {error}
                </div>
              )}

              <div className="px-4 py-3 bg-light-bg-secondary dark:bg-dark-bg-secondary border-2 border-light-border dark:border-dark-border rounded-lg text-light-text dark:text-dark-text text-sm">
                <div className="font-semibold mb-1">✨ 智能站点识别</div>
                <div className="text-xs opacity-90">
                  • 自动从localStorage读取system_name作为站点名称<br/>
                  • 自动获取access_token和用户信息<br/>
                  • API Key可选，无需强制填写
                </div>
              </div>

              <button
                onClick={handleUrlSubmit}
                disabled={loading || !url.trim()}
                className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                    启动浏览器中...
                  </>
                ) : (
                  <>
                    <Globe className="w-5 h-5 text-white" />
                    下一步：浏览器登录
                  </>
                )}
              </button>
            </div>
          )}

          {/* 步骤2: 浏览器登录 */}
          {step === 'login' && (
            <div className="space-y-4">
              <div className="px-6 py-8 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-600 text-center space-y-4 shadow-md">
                <Globe className="w-16 h-16 mx-auto text-primary-500 dark:text-primary-400 animate-pulse" />
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">请在浏览器中完成登录</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  已在浏览器中打开 <span className="text-primary-600 dark:text-primary-400 font-semibold">{url}</span>
                  <br />
                  请完成登录操作，然后点击下方按钮继续
                </p>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-500/30 border border-red-500/60 rounded-lg text-red-700 dark:text-red-200 text-sm font-medium">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('input-url')}
                  className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition-all"
                >
                  返回
                </button>
                <button
                  onClick={handleLoginComplete}
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      获取信息中...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      已完成登录
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* 步骤3: 获取信息中 */}
          {step === 'fetching' && (
            <div className="px-6 py-12 text-center space-y-4">
              <Loader2 className="w-16 h-16 mx-auto text-primary-400 animate-spin" />
              <h3 className="text-lg font-semibold">正在获取站点信息...</h3>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                自动读取 system_name、userID 和 access_token
              </p>
            </div>
          )}

          {/* 步骤4: 确认信息 */}
          {step === 'confirm' && (
            <div className="space-y-4">
              {/* 编辑模式提示 */}
              {site && (
                <div className="px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-300 text-sm">
                  <div className="font-semibold mb-1">✏️ 编辑模式</div>
                  <div className="text-xs">
                    您可以直接修改下方信息，或点击"重新登录"按钮重新获取站点数据
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">站点名称</div>
                  <input
                    type="text"
                    value={autoInfo.name}
                    onChange={(e) => setAutoInfo({...autoInfo, name: e.target.value})}
                    className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-medium text-right"
                    placeholder="输入站点名称"
                  />
                </div>

                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">站点URL</div>
                  {isEditing ? (
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-medium text-right"
                      placeholder="https://api.example.com"
                    />
                  ) : (
                    <div className="flex-1 text-slate-800 dark:text-slate-100 break-all font-medium text-right">{url}</div>
                  )}
                </div>

                {autoInfo.balance !== null && (
                  <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mb-1 font-medium">账户余额</div>
                    <div className="text-light-text dark:text-dark-text font-semibold">
                      {autoInfo.balance === -1 ? '∞ 无限' : `$${autoInfo.balance.toFixed(2)}`}
                    </div>
                  </div>
                )}

                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">用户ID</div>
                  <input
                    type="text"
                    value={autoInfo.userId}
                    onChange={(e) => setAutoInfo({...autoInfo, userId: e.target.value})}
                    className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-mono text-sm font-semibold text-right"
                    placeholder="输入用户ID"
                  />
                </div>

                {/* Access Token 输入区域 */}
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">Access Token</span>
                    <div className="flex-1 flex justify-end">
                      {autoInfo.systemToken ? (
                        <div className="flex items-center gap-2 w-full justify-end">
                          <div className="flex-1 text-sm text-slate-800 dark:text-slate-100 font-mono bg-white dark:bg-slate-900 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 text-right">
                            {showToken ? autoInfo.systemToken : maskToken(autoInfo.systemToken)}
                          </div>
                          <button
                            onClick={() => setShowToken(!showToken)}
                            className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors font-medium whitespace-nowrap px-2"
                          >
                            {showToken ? '隐藏' : '显示'}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(autoInfo.systemToken);
                              alert('Access Token已复制到剪贴板');
                            }}
                            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                            title="复制"
                          >
                            📋
                          </button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          value={autoInfo.systemToken}
                          onChange={(e) => setAutoInfo({...autoInfo, systemToken: e.target.value})}
                          placeholder="请手动填入 Access Token"
                          className="w-full bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 font-medium text-right"
                        />
                      )}
                    </div>
                  </div>
                  {!autoInfo.systemToken && (
                    <div className="text-sm text-yellow-700 dark:text-yellow-400 mt-2 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1.5 rounded border border-yellow-200 dark:border-yellow-800 font-medium">
                      ⚠️ 无法自动获取 Access Token，可能session已过期。请点击"重新登录"或从网站复制填入
                    </div>
                  )}
                </div>

                {/* 加油站链接输入区域 */}
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mb-1 font-medium">
                    加油站链接 <span className="text-slate-400 dark:text-slate-500">(可选)</span>
                  </div>
                  <input
                    type="url"
                    value={autoInfo.extraLinks}
                    onChange={(e) => setAutoInfo({...autoInfo, extraLinks: e.target.value})}
                    className="w-full bg-transparent border-none outline-none text-light-text dark:text-dark-text font-mono text-sm placeholder-slate-400 dark:placeholder-slate-500"
                    placeholder="https://example.com/lottery (抽奖/额外签到等链接)"
                  />
                  <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                    💡 有些站点虽然没有签到功能，但有其他的抽奖或签到网站，可在此添加快捷链接
                  </div>
                </div>

                {/* 签到功能开关 */}
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoInfo.enableCheckin}
                      onChange={(e) => setAutoInfo({...autoInfo, enableCheckin: e.target.checked})}
                      className="w-4 h-4 rounded border-gray-400 dark:border-gray-500 text-primary-600 focus:ring-primary-500 focus:ring-offset-white dark:focus:ring-offset-gray-900"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-300">启用签到功能</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        📅 勾选后，一级面板会显示签到图标，刷新站点时会自动获取签到状态
                      </div>
                    </div>
                  </label>
                </div>

                {!site && (
                  <div className="px-4 py-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="font-semibold">{autoInfo.systemToken ? "信息已自动获取" : "请手动填入 Access Token"}，点击保存即可完成添加</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    // 编辑模式：返回到input-url步骤重新开始流程
                    // 新增模式：返回到login步骤
                    if (site) {
                      setStep('input-url');
                    } else {
                      setStep('login');
                    }
                  }}
                  className="flex-1 px-6 py-3 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <Globe className="w-5 h-5" />
                  {site ? '重新登录获取信息' : '重新登录'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!autoInfo.name || !url || !autoInfo.systemToken || !autoInfo.userId}
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <CheckCircle className="w-5 h-5" />
                  {site ? '保存修改' : '保存站点'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteEditor;
/*** End of File */
