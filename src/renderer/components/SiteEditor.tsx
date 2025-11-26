import { useState } from "react";
import { X, Loader2, Globe, CheckCircle } from "lucide-react";
import { SiteConfig } from "../App";

interface Props {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
}

type Step = "input-url" | "login" | "fetching" | "confirm";
// 新增：添加方式模式，auto=智能添加，manual=手动添加
type Mode = "auto" | "manual";

export function SiteEditor({ site, onSave, onCancel }: Props) {
  // 编辑模式下直接跳到确认步骤，新增模式从输入URL开始
  const [step, setStep] = useState<Step>(site ? "confirm" : "input-url");
  const [mode, setMode] = useState<Mode>("auto"); // 当前添加模式
  const [url, setUrl] = useState(site?.url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false); // 控制令牌显示/隐藏
  const isEditing = !!site; // 判断是否为编辑模式
  // 自动/手动共用的信息结构
  const [autoInfo, setAutoInfo] = useState({
    name: site?.name || "",
    apiKey: site?.api_key || "",
    systemToken: site?.system_token || "",
    userId: site?.user_id || "",
    balance: null as number | null,
    extraLinks: site?.extra_links || "", // 加油站链接
    enableCheckin: site?.force_enable_checkin || false, // 启用签到功能
  });

  const maskToken = (token: string): string => {
    if (!token) return "";
    if (token.length <= 8) return "***";
    return `${token.substring(0, 3)}...${token.substring(token.length - 4)}`;
  };

  // URL 严格校验与归一化逻辑（保留 PR 中的改动）
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

  const handleUrlSubmit = async () => {
    if (!url.trim()) {
      setError("请输入站点URL");
      return;
    }
    const finalUrl = normalizeUrl(url);
    if (!isValidUrlStrict(finalUrl)) {
      setError("URL格式不合法，请输入形如 https://example.com 的地址");
      return;
    }
    setUrl(finalUrl);
    setLoading(true);
    setError("");
    try {
      const result = await window.electronAPI.launchChromeForLogin(finalUrl);
      if (result.success) setStep("login");
      else setError(result.message);
    } catch (err: any) {
      setError("启动浏览器失败: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginComplete = async () => {
    setStep("fetching");
    setLoading(true);
    setError("");
    // 保留超时保护逻辑
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), 30000);
    });
    try {
      const siteAccountResult = (await Promise.race([
        (window.electronAPI as any).token.initializeSite(url),
        timeout,
      ])) as any;
      if (!siteAccountResult.success)
        throw new Error(siteAccountResult.error || "初始化站点失败");
      const { user_id, site_name, access_token, supportsCheckIn } =
        siteAccountResult.data;
      if (!user_id)
        throw new Error("初始化站点返回的数据中缺少用户ID");
      setAutoInfo({
        name: site_name || extractDomainName(url),
        apiKey: "",
        systemToken: access_token || "",
        userId: String(user_id),
        balance: null,
        extraLinks: "",
        enableCheckin: supportsCheckIn === true,
      });
      setStep("confirm");
    } catch (err: any) {
      // 失败时允许用户继续在确认页手动填写
      setError("获取站点信息失败: " + err.message);
      setStep("confirm");
    } finally {
      setLoading(false);
    }
  };

  const extractDomainName = (u: string): string => {
    try {
      const urlObj = new URL(u);
      let hostname = urlObj.hostname.replace("www.", "");
      const parts = hostname.split(".");
      if (parts.length >= 2)
        return parts.length > 2 ? parts[parts.length - 2] : parts[0];
      return hostname;
    } catch {
      return "新站点";
    }
  };

  const handleSave = () => {
    // 构建站点配置，包含签到与加油站配置
    const newSite: SiteConfig = {
      name: autoInfo.name || extractDomainName(url),
      url: url.trim(),
      api_key: autoInfo.apiKey,
      system_token: autoInfo.systemToken,
      user_id: autoInfo.userId,
      enabled: true,
      has_checkin: false,
      extra_links: autoInfo.extraLinks,
      force_enable_checkin: autoInfo.enableCheckin,
    };
    onSave(newSite);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-light-card dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl md:max-w-3xl border border-slate-200 dark:border-slate-700 max-h-[85vh] flex flex-col">
        {/* 头部：标题 + 添加方式切换 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">
              {site
                ? "编辑站点"
                : mode === "manual"
                ? "手动添加站点"
                : "智能添加站点"}
            </h2>
            {/* 新增站点时提供模式切换：智能添加（默认） / 手动添加 */}
            {!site && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium">添加方式：</span>
                <button
                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                    mode === "auto"
                      ? "bg-primary-500 text-white border-primary-500"
                      : "bg-transparent text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600"
                  }`}
                  onClick={() => {
                    // 切换回智能添加：回到浏览器引导流程
                    setMode("auto");
                    setStep("input-url");
                    setError("");
                  }}
                >
                  智能添加（默认）
                </button>
                <button
                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                    mode === "manual"
                      ? "bg-primary-500 text-white border-primary-500"
                      : "bg-transparent text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600"
                  }`}
                  onClick={() => {
                    // 切换为手动添加：直接进入确认/手动填写步骤
                    setMode("manual");
                    setStep("confirm");
                    setError("");
                  }}
                >
                  手动添加站点
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* 步骤指示器：智能添加模式或编辑模式显示 */}
          {(mode === "auto" || site) && (
            <div className="flex items-center justify-between">
              {[
                { id: "input-url", label: "输入URL", icon: "1" },
                { id: "login", label: "浏览器登录", icon: "2" },
                { id: "fetching", label: "获取信息", icon: "3" },
                { id: "confirm", label: "确认保存", icon: "4" },
              ].map((s, idx) => (
                <div key={s.id} className="flex items-center flex-1">
                  <div
                    className={`flex items-center gap-2 ${
                      step === s.id
                        ? "text-primary-600 dark:text-primary-400"
                        : ["login", "fetching", "confirm"].indexOf(s.id) <=
                          ["login", "fetching", "confirm"].indexOf(
                            step as any
                          )
                        ? "text-green-600 dark:text-green-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-base text-white shadow-md ${
                        step === s.id
                          ? "bg-primary-500"
                          : ["login", "fetching", "confirm"].indexOf(s.id) <=
                            ["login", "fetching", "confirm"].indexOf(
                              step as any
                            )
                          ? "bg-green-500"
                          : "bg-slate-400 dark:bg-slate-600"
                      }`}
                    >
                      {s.icon}
                    </div>
                    <span className="text-sm font-semibold">{s.label}</span>
                  </div>
                  {idx < 3 && (
                    <div
                      className={`flex-1 h-1 mx-2 rounded ${
                        ["login", "fetching", "confirm"].indexOf(
                          ["input-url", "login", "fetching", "confirm"][idx + 1]
                        ) <=
                        ["login", "fetching", "confirm"].indexOf(step as any)
                          ? "bg-green-500"
                          : "bg-slate-300 dark:bg-slate-600"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 步骤1：输入URL（仅智能添加模式使用） */}
          {mode === "auto" && step === "input-url" && (
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

          {/* 步骤3：获取信息中（仅智能添加模式使用） */}
          {mode === "auto" && step === "fetching" && (
            <div className="px-6 py-12 text-center space-y-4">
              <Loader2 className="w-16 h-16 mx-auto text-primary-400 animate-spin" />
              <h3 className="text-lg font-semibold">正在获取站点信息...</h3>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">自动读取 system_name、userID 和 access_token</p>
            </div>
          )}

          {/* 步骤4：确认信息（智能添加完成后或手动添加模式下使用） */}
          {step === "confirm" && (
            <div className="space-y-4">
              {/* 通用错误提示：包括从自动获取流程返回的手动填写提示 */}
              {error && (
                <div className="px-4 py-3 bg-red-500/20 border border-red-500/60 rounded-lg text-red-100 text-xs whitespace-pre-line">
                  {error}
                </div>
              )}

              {/* 新增站点的手动模式提示 */}
              {!site && mode === "manual" && (
                <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-300 dark:border-blue-600 rounded-lg text-blue-700 dark:text-blue-300 text-sm">
                  <div className="font-semibold mb-1">当前为手动添加模式</div>
                  <div className="text-xs opacity-90">
                    请输入站点URL、用户ID和 Access Token。保存后将直接作为固定配置使用，不会触发浏览器登录流程。
                  </div>
                </div>
              )}

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
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                      Access Token
                    </span>
                    <div className="flex-1 flex justify-end">
                      {autoInfo.systemToken ? (
                        <div className="flex items-center gap-2 w-full justify-end">
                          <div className="flex-1 text-sm text-slate-800 dark:text-slate-100 font-mono bg-white dark:bg-slate-900 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 text-right">
                            {showToken
                              ? autoInfo.systemToken
                              : maskToken(autoInfo.systemToken)}
                          </div>
                          <button
                            onClick={() => setShowToken(!showToken)}
                            className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors font-medium whitespace-nowrap px-2"
                          >
                            {showToken ? "隐藏" : "显示"}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(autoInfo.systemToken);
                              alert("Access Token已复制到剪贴板");
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
                          onChange={(e) =>
                            setAutoInfo({
                              ...autoInfo,
                              systemToken: e.target.value,
                            })
                          }
                          placeholder="请手动填入 Access Token"
                          className="w-full bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 font-medium text-right"
                        />
                      )}
                    </div>
                  </div>
                  {/* 仅在智能添加模式下提示自动获取失败，手动添加模式不再显示此提醒 */}
                  {!autoInfo.systemToken && mode === "auto" && (
                    <div className="text-sm text-yellow-700 dark:text-yellow-400 mt-2 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1.5 rounded border border-yellow-200 dark:border-yellow-800 font-medium">
                      ⚠️ 无法自动获取 Access Token，可能session已过期。请点击"重新登录"或从网站复制填入
                    </div>
                  )}
                </div>

                {/* 加油站链接输入区域 */}
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    加油站链接
                  </div>
                  <input
                    type="url"
                    value={autoInfo.extraLinks}
                    onChange={(e) =>
                      setAutoInfo({
                        ...autoInfo,
                        extraLinks: e.target.value,
                      })
                    }
                    className="flex-1 bg-transparent border-none outline-none text-light-text dark:text-dark-text font-mono text-sm placeholder-slate-400 dark:placeholder-slate-500 text-right"
                    placeholder="https://example.com/lottery"
                  />
                </div>

                {/* 签到功能开关 */}
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoInfo.enableCheckin}
                      onChange={(e) =>
                        setAutoInfo({
                          ...autoInfo,
                          enableCheckin: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-gray-400 dark:border-gray-500 text-primary-600 focus:ring-primary-500 focus:ring-offset-white dark:focus:ring-offset-gray-900"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        启用签到功能
                      </div>
                    </div>
                  </label>
                </div>

                {/* 仅在智能添加模式下展示自动获取状态提示，手动添加模式不显示此文案 */}
                {!site && mode === "auto" && (
                  <div className="px-4 py-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="font-semibold">
                      {autoInfo.systemToken
                        ? "信息已自动获取"
                        : "请手动填入 Access Token"}
                      ，点击保存即可完成添加
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                {(mode === "auto" || site) && (
                  <button
                    onClick={() => {
                      // 编辑模式：返回到input-url步骤重新开始流程
                      // 新增模式：返回到login步骤
                      if (site) {
                        setStep("input-url");
                      } else {
                        setStep("login");
                      }
                    }}
                    className="flex-1 px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Globe className="w-5 h-5" />
                    {site ? "重新登录获取信息" : "重新登录"}
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={
                    !autoInfo.name ||
                    !url ||
                    !autoInfo.systemToken ||
                    !autoInfo.userId
                  }
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <CheckCircle className="w-5 h-5" />
                  {site ? "保存修改" : "保存站点"}
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
