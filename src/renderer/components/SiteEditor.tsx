
import { useState } from "react";
import { X, Loader2, Chrome, CheckCircle } from "lucide-react";
import { SiteConfig } from "../App";

interface Props {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
}

type Step = 'input-url' | 'login' | 'fetching' | 'confirm';

export function SiteEditor({ site, onSave, onCancel }: Props) {
  // 编辑模式下直接跳到确认步骤，新增模式从输入URL开始
  const [step, setStep] = useState<Step>(site ? 'confirm' : 'input-url');
  const [url, setUrl] = useState(site?.url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false); // 控制令牌显示/隐藏
  
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

  const handleUrlSubmit = async () => {
    if (!url.trim()) {
      setError("请输入站点URL");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 启动Chrome让用户登录
      const result = await window.electronAPI.launchChromeForLogin(url);
      
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
   * 从URL中提取站点名称
   * 优先使用域名主要部分，去除常见的www前缀和TLD后缀
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-light-card dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
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
        <div className="px-6 py-6 space-y-6">
          {/* 步骤指示器 */}
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

          {/* 步骤1: 输入URL */}
          {step === 'input-url' && (
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

              <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-300 dark:border-blue-600 rounded-lg text-blue-700 dark:text-blue-300 text-sm">
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
                className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    启动浏览器中...
                  </>
                ) : (
                  <>
                    <Chrome className="w-5 h-5" />
                    下一步：浏览器登录
                  </>
                )}
              </button>
            </div>
          )}

          {/* 步骤2: 浏览器登录 */}
          {step === 'login' && (
            <div className="space-y-4">
              <div className="px-6 py-8 bg-black/30 rounded-xl border border-slate-200 dark:border-slate-700 text-center space-y-4">
                <Chrome className="w-16 h-16 mx-auto text-primary-400 animate-pulse" />
                <h3 className="text-lg font-semibold">请在浏览器中完成登录</h3>
                <p className="text-sm text-light-secondary dark:text-dark-secondary">
                  已在Chrome中打开 <span className="text-primary-400">{url}</span>
                  <br />
                  请完成登录操作，然后点击下方按钮继续
                </p>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('input-url')}
                  className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-lg font-semibold transition-all"
                >
                  返回
                </button>
                <button
                  onClick={handleLoginComplete}
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
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
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mb-1 font-medium">站点名称</div>
                  <input
                    type="text"
                    value={autoInfo.name}
                    onChange={(e) => setAutoInfo({...autoInfo, name: e.target.value})}
                    className="w-full bg-transparent border-none outline-none text-light-text dark:text-dark-text font-medium"
                    placeholder="输入站点名称"
                  />
                </div>

                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mb-1 font-medium">站点URL</div>
                  {site ? (
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-light-text dark:text-dark-text font-medium"
                      placeholder="https://api.example.com"
                    />
                  ) : (
                    <div className="text-light-text dark:text-dark-text break-all font-medium">{url}</div>
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

                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mb-1 font-medium">用户ID</div>
                  <input
                    type="text"
                    value={autoInfo.userId}
                    onChange={(e) => setAutoInfo({...autoInfo, userId: e.target.value})}
                    className="w-full bg-transparent border-none outline-none text-light-text dark:text-dark-text font-mono text-sm font-medium"
                    placeholder="输入用户ID"
                  />
                </div>

                {/* Access Token 输入区域 */}
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary font-medium">Access Token</span>
                    {autoInfo.systemToken && (
                      <button
                        onClick={() => setShowToken(!showToken)}
                        className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                      >
                        {showToken ? '隐藏' : '显示'}
                      </button>
                    )}
                  </div>
                  {autoInfo.systemToken ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 text-sm text-light-text dark:text-dark-text font-mono bg-white dark:bg-slate-900 px-3 py-2 rounded border border-slate-200 dark:border-slate-600">
                        {showToken ? autoInfo.systemToken : maskToken(autoInfo.systemToken)}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(autoInfo.systemToken);
                          alert('Access Token已复制到剪贴板');
                        }}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors text-light-secondary dark:text-dark-secondary hover:text-white"
                        title="复制"
                      >
                        📋
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="password"
                        value={autoInfo.systemToken}
                        onChange={(e) => setAutoInfo({...autoInfo, systemToken: e.target.value})}
                        placeholder="请手动填入 Access Token"
                        className="w-full bg-transparent border-none outline-none text-light-text dark:text-dark-text placeholder-slate-400 dark:placeholder-slate-500 font-medium"
                      />
                      <div className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 font-medium">
                        ⚠️ 无法自动获取 Access Token，可能session已过期。请点击"重新登录"或从网站复制填入
                      </div>
                    </>
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
                      className="w-4 h-4 rounded border-gray-600 text-primary-600 focus:ring-primary-500 focus:ring-offset-gray-900"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">启用签到功能</div>
                      <div className="text-xs text-gray-500 mt-1">
                        📅 勾选后，一级面板会显示签到图标，刷新站点时会自动获取签到状态
                      </div>
                    </div>
                  </label>
                </div>

                {!site && (
                  <div className="px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {autoInfo.systemToken ? "信息已自动获取" : "请手动填入 Access Token"}，点击保存即可完成添加
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
                  <Chrome className="w-5 h-5" />
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