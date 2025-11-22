import { useState } from "react";
import { X, Loader2, Globe, CheckCircle } from "lucide-react";
import { SiteConfig } from "../App";

interface Props {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
}

type Step = 'input-url' | 'login' | 'fetching' | 'confirm';

export function SiteEditor({ site, onSave, onCancel }: Props) {
  const [step, setStep] = useState<Step>(site ? 'confirm' : 'input-url');
  const [url, setUrl] = useState(site?.url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false);
  const isEditing = !!site;
  const [autoInfo, setAutoInfo] = useState({
    name: site?.name || "",
    apiKey: site?.api_key || "",
    systemToken: site?.system_token || "",
    userId: site?.user_id || "",
    balance: null as number | null,
    extraLinks: site?.extra_links || "",
    enableCheckin: site?.force_enable_checkin || false,
  });

  const [mode, setMode] = useState<'auto' | 'import'>('auto');
  const [importText, setImportText] = useState("");
  const [importHint, setImportHint] = useState("");
  const [copyHint, setCopyHint] = useState("");
  const [copyTargetHint, setCopyTargetHint] = useState("");

  const maskToken = (token: string): string => {
    if (!token) return '';
    if (token.length <= 8) return '***';
    return `${token.substring(0, 3)}...${token.substring(token.length - 4)}`;
  };

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

  const normalizeUrl = (value: string): string => {
    let v = (value || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v;
  };

  /**
   * 生成最小化控制台脚本（中文）
   * 用于在目标站点控制台执行并输出统一 JSON
   */
  const getMinimalConsoleScript = (): string => {
    const s = [
      '(function(){',
      'var origin=(new URL(location.href)).origin;',
      'function parseJSON(str){try{return JSON.parse(str)}catch(e){return null}}',
      'function pick(obj,keys){var v=null;for(var i=0;i<keys.length;i++){var k=keys[i];if(obj&&obj[k]!=null){if(v===null){v=obj[k]}}}return v}',
      'function tryFetch(url,headers){var h=Object.assign({"Accept":"application/json, text/plain, */*","Cache-Control":"no-store","Pragma":"no-cache"},headers||{});return fetch(url,{method:"GET",credentials:"include",headers:h}).then(function(resp){return resp.text().then(function(text){if(!resp.ok)throw new Error("HTTP "+resp.status+" "+text.slice(0,120));if(text.indexOf("<!DOCTYPE")>=0)throw new Error("HTML "+text.slice(0,120));var data=parseJSON(text);if(!data)throw new Error("not valid JSON");return data})})}',
      'function scanStoresForToken(stores){var token=null;for(var si=0;si<stores.length;si++){var store=stores[si];for(var i=0;i<store.length;i++){var key=store.key(i);var val=store.getItem(key);if(!val)continue;var obj=parseJSON(val);if(obj&&typeof obj==="object"){var ks=["access_token","accessToken","token","auth_token","authToken","api_token","bearer_token"];for(var j=0;j<ks.length;j++){var v=obj[ks[j]];if(typeof v==="string"&&v.length>15){token=token||v}}}else if(typeof val==="string"){var m=val.match(/[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/);if(m&&m[0]&&m[0].length>30){token=token||m[0]}}}}return token}',
      'function readCookieToken(){var map={};var parts=document.cookie.split(";");for(var i=0;i<parts.length;i++){var p=parts[i];var seg=p.split("=");var k=seg[0];var rest=seg.slice(1).join("=");if(!k)continue;map[k.trim()]=rest.trim()}var ks=["access_token","token","auth_token","api_token","bearer_token"];for(var j=0;j<ks.length;j++){var v=map[ks[j]];if(v&&v.length>15)return v}for(var k in map){var v=map[k];var m=v&&v.match(/Bearer\s+([^;\s]+)/i);if(m&&m[1])return m[1]}return null}',
      'function readLocal(){var s=window.localStorage;var ss=window.sessionStorage;var user=parseJSON(s.getItem("user"));var siteInfo=parseJSON(s.getItem("siteInfo"));var userInfo=parseJSON(s.getItem("userInfo"));var config=parseJSON(s.getItem("config")||s.getItem("siteConfig"));var status=parseJSON(s.getItem("status")||s.getItem("siteStatus"));var checkIn=parseJSON(s.getItem("checkIn")||s.getItem("check_in"));var uid=null;uid=pick(user,["id","user_id","userId","uid","user_ID"])||pick(siteInfo,["id","user_id","userId","uid"])||pick(userInfo,["id","user_id","userId"])||(s.getItem("user_id")||s.getItem("userId")||s.getItem("uid")||s.getItem("id"));var tokenKnown=pick(user,["access_token","accessToken","token","auth_token","authToken","api_token","bearer_token"])||pick(siteInfo,["access_token","accessToken","token"])||((parseJSON(s.getItem("auth")||s.getItem("authentication"))||{}).access_token)||s.getItem("access_token")||s.getItem("accessToken")||s.getItem("token")||s.getItem("auth_token")||s.getItem("authToken")||s.getItem("api_token")||s.getItem("apiToken")||s.getItem("bearer_token");var tokenScan=scanStoresForToken([s,ss]);var tokenCookie=readCookieToken();var accessToken=tokenKnown||tokenScan||tokenCookie||null;var username=pick(user,["username","name","display_name","displayName","nickname","login"])||pick(siteInfo,["username","name","display_name","user_name"])||pick(userInfo,["username","name"])||s.getItem("username")||s.getItem("user_name")||s.getItem("nickname");var systemName=pick(siteInfo,["system_name","systemName","site_name","siteName","name"])||pick(config,["system_name","systemName","site_name","name"])||s.getItem("system_name")||s.getItem("systemName")||s.getItem("site_name")||s.getItem("siteName")||s.getItem("app_name");var supportsCheckIn=(status&&status.check_in_enabled!=null)?status.check_in_enabled:(checkIn&&typeof checkIn.enabled!=="undefined"?checkIn.enabled:null);var canCheckIn=(user&&user.can_check_in!=null)?user.can_check_in:(checkIn&&typeof checkIn.can_check_in!=="undefined"?checkIn.can_check_in:null);return {uid:uid,username:username,system_name:systemName,access_token:accessToken,supportsCheckIn:supportsCheckIn,canCheckIn:canCheckIn}}',
      'function getSiteToken(uid){var headers={"Accept":"application/json, text/plain, */*","Referer":origin+"/console/token","New-API-User":String(uid),"Veloera-User":String(uid),"voapi-user":String(uid),"User-id":String(uid),"Cache-Control":"no-store","Pragma":"no-cache"};var bases=[origin,origin+"/console"];var i=0;function next(){if(i>=bases.length)return Promise.resolve(null);var base=bases[i++];return tryFetch(base+"/api/user/token",headers).then(function(data){if(typeof data==="string")return data;if(data&&typeof data.data==="string")return data.data;if(data&&typeof data.token==="string")return data.token;if(data&&data.data&&typeof data.data.token==="string")return data.data.token;return null}).catch(function(){return next()})}return next()}',
      'function getApiKeys(uid){var headers={"Accept":"application/json, text/plain, */*","Referer":origin+"/console/token","New-API-User":String(uid),"Veloera-User":String(uid),"voapi-user":String(uid),"User-id":String(uid),"Cache-Control":"no-store","Pragma":"no-cache"};var bases=[origin,origin+"/console"];var urls=[];for(var b=0;b<bases.length;b++){var base=bases[b];urls.push(base+"/api/token/?page=1&size=100&keyword=&order=-id");urls.push(base+"/api/token/?p=1&size=100");urls.push(base+"/api/token/?p=0&size=100");urls.push(base+"/api/token/")}var i=0;function next(){if(i>=urls.length)return Promise.resolve([]);var url=urls[i++];return tryFetch(url,headers).then(function(data){var items=Array.isArray(data)?data:(Array.isArray(data&&data.data)?data.data:(Array.isArray(data&&data.data&&data.data.items)?data.data.items:(Array.isArray(data&&data.items)?data.items:[])));if(items.length>0)return items;return next()}).catch(function(){return next()})}return next()}',
      'function getStatus(){var bases=[origin,origin+"/console"];var i=0;function next(){if(i>=bases.length)return Promise.resolve(null);var base=bases[i++];return tryFetch(base+"/api/status",{}).then(function(s){var name=null;if(s&&s.data){name=s.data.system_name||s.data.systemName||s.data.site_name||s.data.name}return name}).catch(function(){return next()})}return next()}',
      'function readViaApi(){var endpoints=["/api/user/self","/api/user/dashboard","/api/user"];var user={};var i=0;function next(){if(i>=endpoints.length)return Promise.resolve(user);var p=endpoints[i++];var hdr={"Accept":"application/json, text/plain, */*","Cache-Control":"no-store","Pragma":"no-cache"};if(uid!=null){hdr["New-API-User"]=String(uid);hdr["Veloera-User"]=String(uid);hdr["voapi-user"]=String(uid);hdr["User-id"]=String(uid);}return tryFetch(origin+p,hdr).then(function(data){var u=(data&&data.data)?data.data:data;if(u&&(u.id!=null||u.user_id!=null)){user.user_id=u.id||u.user_id||u.userId||u.uid||u.user_ID;user.username=u.username||u.name||u.display_name||u.displayName||u.nickname||u.login||u.user_name;user.access_token=u.access_token||u.accessToken||u.token||u.auth_token||u.authToken||u.api_token||u.bearer_token;return user}return next()}).catch(function(){return next()})}return next()}',
      'var local=readLocal();var uid=local.uid;var username=local.username;var localToken=local.access_token;var localName=local.system_name;',
      'if(!uid){console.log("未发现 user_id，请先进入控制台用户页或手动填写");return}',
      'Promise.all([readViaApi(),getSiteToken(uid),getApiKeys(uid),getStatus()]).then(function(arr){var remote=arr[0]||{};var siteToken=arr[1];var keys=arr[2]||[];var apiKey=keys.length?keys[0].key:null;var siteName=arr[3]||localName||"";var finalToken=localToken||remote.access_token||siteToken||apiKey||null;var finalUsername=username||remote.username||null;var payload={site_url:origin.replace(/[`]/g,"").trim(),site_name:siteName||new URL(origin).hostname,user_id:Number(uid),username:finalUsername,access_token:finalToken,api_key:apiKey||null,supportsCheckIn:(local.supportsCheckIn!=null?local.supportsCheckIn:null),canCheckIn:(local.canCheckIn!=null?local.canCheckIn:null)};var out=JSON.stringify(payload);console.log("控制台导出JSON如下，复制到应用：");console.log(out);var autoCopied=false;if(navigator.clipboard&&navigator.clipboard.writeText){try{navigator.clipboard.writeText(out).then(function(){autoCopied=true;console.log("✅ 已自动复制到剪贴板")}).catch(function(){})}catch(e){}}if(!autoCopied){try{var ta=document.createElement("textarea");ta.value=out;ta.style.position="fixed";ta.style.top="-1000px";document.body.appendChild(ta);ta.focus();ta.select();var ok=false;try{ok=document.execCommand&&document.execCommand("copy")}catch(e){}document.body.removeChild(ta);if(ok){console.log("✅ 已自动复制到剪贴板 (fallback)")}else{console.log("⚠️ 自动复制失败，请手动复制上方 JSON")}}catch(e){console.log("⚠️ 自动复制异常，请手动复制：",e&&e.message?e.message:String(e))}}}).catch(function(e){console.log("[MinimalScript] fatal:",e&&e.message?e.message:String(e))})',
      '})();'
    ];
    return s.join('\n');
  };

  /**
   * 计算推荐的控制台页面 URL（中文）
   * 返回 origin + '/console/token'，用于引导用户生成令牌
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
   * 复制目标控制台地址到剪贴板（中文）
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
   * 通过主进程在系统浏览器打开推荐控制台地址（中文）
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
   * 复制控制台脚本（中文）
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

  /**
   * 导入控制台 JSON 并直接保存站点（中文）
   */
  const handleImportSave = () => {
    try {
      setImportHint('');
      if (!importText.trim()) { setImportHint('请粘贴控制台输出的JSON数据'); return; }
      const payload = JSON.parse(importText);
      const siteUrl: string = (payload.site_url || payload.base_url || payload.url || '').trim();
      const siteName: string = (payload.site_name || payload.system_name || '').trim();
      const userIdRaw = payload.user_id ?? payload.uid ?? payload.id;
      const token: string = (payload.access_token || payload.token || payload.auth_token || '').trim();
      const apiKey: string = (payload.api_key || '').trim();
      if (!siteUrl) { setImportHint('缺少 site_url 字段'); return; }
      if (!userIdRaw) { setImportHint('缺少 user_id 字段'); return; }
      if (!token && !apiKey) { setImportHint('缺少访问令牌或API Key'); return; }
      const newSite: SiteConfig = {
        name: siteName || extractDomainName(siteUrl),
        url: siteUrl,
        api_key: apiKey || '',
        system_token: token || undefined,
        user_id: String(userIdRaw),
        enabled: true,
        has_checkin: false,
        extra_links: '',
        force_enable_checkin: false,
      };
      onSave(newSite);
      setImportHint('✅ 已导入并保存站点');
    } catch (e: any) {
      setImportHint('JSON解析失败：' + (e.message || String(e)));
    }
  };

  const handleUrlSubmit = async () => {
    if (!url.trim()) { setError("请输入站点URL"); return; }
    const finalUrl = normalizeUrl(url);
    if (!isValidUrlStrict(finalUrl)) { setError("URL格式不合法，请输入形如 https://example.com 的地址"); return; }
    setUrl(finalUrl);
    setLoading(true); setError("");
    try {
      const result = await window.electronAPI.launchChromeForLogin(finalUrl);
      if (result.success) setStep('login'); else setError(result.message);
    } catch (err: any) {
      setError("启动浏览器失败: " + err.message);
    } finally { setLoading(false); }
  };

  const handleLoginComplete = async () => {
    setStep('fetching'); setLoading(true); setError("");
    const timeout = new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('TIMEOUT')), 30000); });
    try {
      const siteAccountResult = await Promise.race([(window.electronAPI as any).token.initializeSite(url), timeout]) as any;
      if (!siteAccountResult.success) throw new Error(siteAccountResult.error || '初始化站点失败');
      const { user_id, site_name, access_token, supportsCheckIn } = siteAccountResult.data;
      if (!user_id) throw new Error('初始化站点返回的数据中缺少用户ID');
      setAutoInfo({ name: site_name || extractDomainName(url), apiKey: "", systemToken: access_token || "", userId: String(user_id), balance: null, extraLinks: "", enableCheckin: supportsCheckIn === true });
      setStep('confirm');
    } catch (err: any) {
      setError("获取站点信息失败: " + err.message); setStep('confirm');
    } finally { setLoading(false); }
  };

  const extractDomainName = (u: string): string => {
    try {
      const urlObj = new URL(u); let hostname = urlObj.hostname.replace('www.', ''); const parts = hostname.split('.');
      if (parts.length >= 2) return parts.length > 2 ? parts[parts.length - 2] : parts[0];
      return hostname;
    } catch { return "新站点"; }
  };

  const handleSave = () => {
    const newSite: SiteConfig = { name: autoInfo.name || extractDomainName(url), url: url.trim(), api_key: autoInfo.apiKey, system_token: autoInfo.systemToken, user_id: autoInfo.userId, enabled: true, has_checkin: false, extra_links: autoInfo.extraLinks, force_enable_checkin: autoInfo.enableCheckin };
    onSave(newSite);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-light-card dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl md:max-w-3xl border border-slate-200 dark:border-slate-700 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-col gap-1"><h2 className="text-xl font-bold">{site ? "编辑站点" : "智能添加站点"}</h2></div>
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-6 space-y-6">
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

          {mode==='auto' && (
          <div className="flex items-center justify-between">
            {[{id:'input-url',label:'输入URL',icon:'1'},{id:'login',label:'浏览器登录',icon:'2'},{id:'fetching',label:'获取信息',icon:'3'},{id:'confirm',label:'确认保存',icon:'4'}].map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className={`flex items-center gap-2 ${step === s.id ? 'text-primary-600 dark:text-primary-400' : ['login','fetching','confirm'].indexOf(s.id) <= ['login','fetching','confirm'].indexOf(step as any) ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-base text-white shadow-md ${step === s.id ? 'bg-primary-500' : ['login','fetching','confirm'].indexOf(s.id) <= ['login','fetching','confirm'].indexOf(step as any) ? 'bg-green-500' : 'bg-slate-400 dark:bg-slate-600'}`}>{s.icon}</div>
                  <span className="text-sm font-semibold">{s.label}</span>
                </div>
                {idx < 3 && (<div className={`flex-1 h-1 mx-2 rounded ${['login','fetching','confirm'].indexOf(['input-url','login','fetching','confirm'][idx+1]) <= ['login','fetching','confirm'].indexOf(step as any) ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />)}
              </div>
            ))}
          </div>
          )}

          {mode==='import' && (
            <div className="px-4 py-3 bg-light-bg-secondary dark:bg-dark-bg-secondary border-2 border-light-border dark:border-dark-border rounded-lg text-sm space-y-2 mt-2 text-light-text dark:text-dark-text">
              <div className="font-semibold text-green-700 dark:text-green-300">🧩 控制台数据导入</div>
              <div className="text-xs text-slate-700 dark:text-slate-300">登录目标站点后，到推荐页面控制台粘贴脚本并复制输出 JSON，粘贴到文本框点击导入。</div>
              <div className="space-y-2">
                <label className="block text-xs font-medium">目标站点URL</label>
                <input type="url" value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="https://api.example.com" className="w-full px-3 py-2 bg-light-card dark:bg-dark-bg border-2 border-light-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-700 dark:text-slate-300">推荐页面：</span>
                {getTargetConsoleUrl() ? (
                  <a href={getTargetConsoleUrl()} target="_blank" rel="noreferrer" className="underline text-blue-600 dark:text-blue-400">{getTargetConsoleUrl()}</a>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">请先填写站点URL</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyTargetUrl} disabled={!getTargetConsoleUrl()} className="px-3 py-2 border-2 border-primary-200 dark:border-primary-400/40 bg-transparent text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 rounded-lg text-sm">复制目标地址</button>
                <button onClick={handleOpenTargetUrl} disabled={!getTargetConsoleUrl()} className="px-3 py-2 border-2 border-primary-200 dark:border-primary-400/40 bg-transparent text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 rounded-lg text-sm">打开登录页</button>
                {copyTargetHint && (<span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{copyTargetHint}</span>)}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyConsoleScript} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold">复制控制台脚本</button>
                {copyHint && (<span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{copyHint}</span>)}
              </div>
              <textarea value={importText} onChange={(e)=>setImportText(e.target.value)} placeholder='{"site_url":"https://example.com","site_name":"MySite","user_id":123,"access_token":"..."}' className="w-full mt-2 px-3 py-2 bg-light-card dark:bg-dark-card border-2 border-light-border dark:border-dark-border rounded text-xs font-mono" rows={4} />
              {importHint && (<div className="text-xs font-medium text-green-700 dark:text-green-300">{importHint}</div>)}
              <div className="flex gap-2">
                <button onClick={handleImportSave} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold">导入并保存</button>
              </div>
            </div>
          )}

          {mode==='auto' && step === 'input-url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">站点URL</label>
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" className="w-full px-4 py-3 bg-white dark:bg-dark-bg border-2 border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-light-text dark:text-dark-text placeholder-slate-400 dark:placeholder-slate-500" />
              </div>
              {error && (<div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-600 rounded-lg text-red-700 dark:text-red-300 text-sm font-medium">{error}</div>)}
              <button onClick={handleUrlSubmit} disabled={loading || !url.trim()} className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {loading ? (<><Loader2 className="w-5 h-5 animate-spin text-white" />启动浏览器中...</>) : (<><Globe className="w-5 h-5 text-white" />下一步：浏览器登录</>)}
              </button>
            </div>
          )}

          {step === 'login' && (
            <div className="space-y-4">
              <div className="px-6 py-8 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-600 text-center space-y-4 shadow-md">
                <Globe className="w-16 h-16 mx-auto text-primary-500 dark:text-primary-400 animate-pulse" />
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">请在浏览器中完成登录</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">已在浏览器中打开 <span className="text-primary-600 dark:text-primary-400 font-semibold">{url}</span><br/>完成登录后继续</p>
              </div>
              {error && (<div className="px-4 py-3 bg-red-500/30 border border-red-500/60 rounded-lg text-red-700 dark:text-red-200 text-sm font-medium">{error}</div>)}
              <div className="flex gap-3">
                <button onClick={() => setStep('input-url')} className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition-all">返回</button>
                <button onClick={handleLoginComplete} disabled={loading} className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all">
                  {loading ? (<><Loader2 className="w-5 h-5 animate-spin" />获取信息中...</>) : (<><CheckCircle className="w-5 h-5" />已完成登录</>)}
                </button>
              </div>
            </div>
          )}

          {step === 'fetching' && (
            <div className="px-6 py-12 text-center space-y-4">
              <Loader2 className="w-16 h-16 mx-auto text-primary-400 animate-spin" />
              <h3 className="text-lg font-semibold">正在获取站点信息...</h3>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">自动读取 system_name、userID 和 access_token</p>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              {error && (<div className="px-4 py-3 bg-red-500/20 border border-red-500/60 rounded-lg text-red-100 text-xs whitespace-pre-line">{error}</div>)}
              <div className="space-y-3">
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">站点名称</div>
                  <input type="text" value={autoInfo.name} onChange={(e) => setAutoInfo({...autoInfo, name: e.target.value})} className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-medium text-right" placeholder="输入站点名称" />
                </div>
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">站点URL</div>
                  {isEditing ? (
                    <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-medium text-right" placeholder="https://api.example.com" />
                  ) : (
                    <div className="flex-1 text-slate-800 dark:text-slate-100 break-all font-medium text-right">{url}</div>
                  )}
                </div>
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">用户ID</div>
                  <input type="text" value={autoInfo.userId} onChange={(e) => setAutoInfo({...autoInfo, userId: e.target.value})} className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-mono text-sm font-semibold text-right" placeholder="输入用户ID" />
                </div>
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-3"><span className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">Access Token</span>
                    <div className="flex-1 flex justify-end">
                      {autoInfo.systemToken ? (
                        <div className="flex items-center gap-2 w-full justify-end">
                          <div className="flex-1 text-sm text-slate-800 dark:text-slate-100 font-mono bg-white dark:bg-slate-900 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 text-right">{showToken ? autoInfo.systemToken : maskToken(autoInfo.systemToken)}</div>
                          <button onClick={() => setShowToken(!showToken)} className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors font-medium whitespace-nowrap px-2">{showToken ? '隐藏' : '显示'}</button>
                          <button onClick={() => { navigator.clipboard.writeText(autoInfo.systemToken); alert('Access Token已复制到剪贴板'); }} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200" title="复制">📋</button>
                        </div>
                      ) : (
                        <input type="password" value={autoInfo.systemToken} onChange={(e) => setAutoInfo({...autoInfo, systemToken: e.target.value})} placeholder="请手动填入 Access Token" className="w-full bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 font-medium text-right" />
                      )}
                    </div>
                  </div>
                  {!autoInfo.systemToken && (<div className="text-sm text-yellow-700 dark:text-yellow-400 mt-2 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1.5 rounded border border-yellow-200 dark:border-yellow-800 font-medium">⚠️ 无法自动获取 Access Token，可能session已过期。请点击"重新登录"或从网站复制填入</div>)}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { if (site) setStep('input-url'); else setStep('login'); }} className="flex-1 px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"><Globe className="w-5 h-5" />{site ? '重新登录获取信息' : '重新登录'}</button>
                  <button onClick={handleSave} disabled={!autoInfo.name || !url || !autoInfo.systemToken || !autoInfo.userId} className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"><CheckCircle className="w-5 h-5" />{site ? '保存修改' : '保存站点'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteEditor;
