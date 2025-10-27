
import { useState } from "react";
import { X, Loader2, Chrome, CheckCircle } from "lucide-react";
import { SiteConfig } from "../App";

interface Props {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
}

type Step = 'input-url' | 'login' | 'fetching' | 'confirm';

export function SiteEditorV2({ site, onSave, onCancel }: Props) {
  const [step, setStep] = useState<Step>('input-url');
  const [url, setUrl] = useState(site?.url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // 自动获取的信息
  const [autoInfo, setAutoInfo] = useState({
    name: site?.name || "",
    apiKey: site?.api_key || "",
    systemToken: site?.system_token || "",
    userId: site?.user_id || "",
    balance: null as number | null,
  });

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

    try {
      console.log('🚀 [SiteEditorV2] 使用TokenService获取令牌...');
      
      // ===== 使用新的TokenService API =====
      const tokenResult = await (window.electronAPI as any).token.getOrCreate(url);
      
      console.log('📦 [SiteEditorV2] TokenService响应:', tokenResult);
      
      if (!tokenResult.success) {
        throw new Error(tokenResult.error || '获取令牌失败');
      }
      
      // TokenService现在返回完整的用户信息（包括ID）
      const { id, username, access_token } = tokenResult.data;
      console.log('✅ [SiteEditorV2] 成功获取令牌:');
      console.log('   - 用户ID:', id);
      console.log('   - 用户名:', username);
      console.log('   - 令牌长度:', access_token?.length || 0);
      
      if (!id) {
        throw new Error('TokenService返回的数据中缺少用户ID');
      }
      
      // 使用TokenService获取余额
      let balance = null;
      const userId = id.toString(); // 转换为字符串用于存储
      
      if (access_token) {
        try {
          console.log('💰 [SiteEditorV2] 获取账户余额...');
          const quotaResult = await (window.electronAPI as any).token.getQuota(
            url,
            id, // 使用TokenService返回的用户ID
            access_token
          );
          
          if (quotaResult.success) {
            const quota = quotaResult.data.quota;
            balance = quota / 500000; // 转换为美元
            console.log('✅ [SiteEditorV2] 余额获取成功:', balance);
          } else {
            console.warn('⚠️ [SiteEditorV2] 获取余额失败:', quotaResult.error);
          }
        } catch (err: any) {
          console.warn('⚠️ [SiteEditorV2] 获取余额异常:', err.message);
        }
      } else {
        console.warn('⚠️ [SiteEditorV2] 没有access_token，跳过余额获取');
      }
      
      console.log('📊 [SiteEditorV2] 最终收集的信息:');
      console.log('   - 站点名称:', username || extractDomainName(url));
      console.log('   - 用户ID:', userId);
      console.log('   - 余额:', balance !== null ? `$${balance.toFixed(2)}` : '未获取');
      
      setAutoInfo({
        name: username || extractDomainName(url),
        apiKey: access_token || "",
        systemToken: access_token || "",
        userId: userId,
        balance: balance,
      });

      setStep('confirm');
    } catch (err: any) {
      console.error('❌ [SiteEditorV2] 获取站点信息失败:', err);
      
      // 根据错误类型提供不同的处理方式
      if (err.message.includes('401') || err.message.includes('Cookie认证失败')) {
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

  const extractDomainName = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return "新站点";
    }
  };

  const handleSave = () => {
    const newSite: SiteConfig = {
      name: autoInfo.name || extractDomainName(url),
      url: url.trim(),
      api_key: autoInfo.apiKey,
      system_token: autoInfo.systemToken,
      user_id: autoInfo.userId,
      enabled: true,
      has_checkin: false,
    };

    onSave(newSite);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-light-card dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-bold">
            {site ? "编辑站点" : "智能添加站点 V2"}
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
                  step === s.id ? 'text-primary-400' : 
                  ['login', 'fetching', 'confirm'].indexOf(s.id) <= ['login', 'fetching', 'confirm'].indexOf(step as any) ? 
                  'text-green-400' : 'text-gray-500'
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    step === s.id ? 'bg-primary-500' :
                    ['login', 'fetching', 'confirm'].indexOf(s.id) <= ['login', 'fetching', 'confirm'].indexOf(step as any) ?
                    'bg-green-500' : 'bg-gray-600'
                  }`}>
                    {s.icon}
                  </div>
                  <span className="text-sm font-medium">{s.label}</span>
                </div>
                {idx < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${
                    ['login', 'fetching', 'confirm'].indexOf(['input-url', 'login', 'fetching', 'confirm'][idx + 1]) <= ['login', 'fetching', 'confirm'].indexOf(step as any) ?
                    'bg-green-500' : 'bg-gray-600'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* 步骤1: 输入URL */}
          {step === 'input-url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-light-secondary dark:text-dark-secondary mb-2">
                  站点URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-4 py-3 bg-black/30 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="mt-2 text-xs text-light-secondary dark:text-dark-secondary">
                  输入API站点的完整URL，例如：https://tbai.xin
                </p>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              <div className="px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-300 text-sm">
                <div className="font-semibold mb-1">✨ 使用TokenService V2</div>
                <div className="text-xs">完全复刻All API Hub的令牌获取机制，支持自动创建access_token</div>
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
                使用TokenService自动读取账户信息、余额等数据
              </p>
            </div>
          )}

          {/* 步骤4: 确认信息 */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="px-4 py-3 bg-black/30 rounded-lg">
                  <div className="text-xs text-light-secondary dark:text-dark-secondary mb-1">站点名称</div>
                  <input
                    type="text"
                    value={autoInfo.name}
                    onChange={(e) => setAutoInfo({...autoInfo, name: e.target.value})}
                    className="w-full bg-transparent border-none outline-none text-white"
                  />
                </div>

                <div className="px-4 py-3 bg-black/30 rounded-lg">
                  <div className="text-xs text-light-secondary dark:text-dark-secondary mb-1">站点URL</div>
                  <div className="text-white break-all">{url}</div>
                </div>

                {autoInfo.balance !== null && (
                  <div className="px-4 py-3 bg-black/30 rounded-lg">
                    <div className="text-xs text-light-secondary dark:text-dark-secondary mb-1">账户余额</div>
                    <div className="text-white">
                      {autoInfo.balance === -1 ? '∞ 无限' : `$${autoInfo.balance.toFixed(2)}`}
                    </div>
                  </div>
                )}

                {autoInfo.userId && (
                  <div className="px-4 py-3 bg-black/30 rounded-lg">
                    <div className="text-xs text-light-secondary dark:text-dark-secondary mb-1">用户ID</div>
                    <div className="text-white font-mono text-sm">{autoInfo.userId}</div>
                  </div>
                )}

                {/* Access Token 输入区域 */}
                <div className="px-4 py-3 bg-black/30 rounded-lg">
                  <div className="text-xs text-light-secondary dark:text-dark-secondary mb-1">Access Token</div>
                  <input
                    type="password"
                    value={autoInfo.systemToken}
                    onChange={(e) => setAutoInfo({...autoInfo, systemToken: e.target.value})}
                    placeholder={autoInfo.systemToken ? "已自动获取" : "请手动填入 Access Token"}
                    className="w-full bg-transparent border-none outline-none text-white placeholder-gray-500"
                  />
                  {!autoInfo.systemToken && (
                    <div className="text-xs text-yellow-400 mt-1">
                      ⚠️ 无法自动获取 Access Token，可能session已过期。请点击"重新登录"或从网站复制填入
                    </div>
                  )}
                </div>

                {/* API Key 输入区域 */}
                <div className="px-4 py-3 bg-black/30 rounded-lg">
                  <div className="text-xs text-light-secondary dark:text-dark-secondary mb-1">API Key (可选)</div>
                  <input
                    type="password"
                    value={autoInfo.apiKey}
                    onChange={(e) => setAutoInfo({...autoInfo, apiKey: e.target.value})}
                    placeholder="API Key (可选，用于备用认证)"
                    className="w-full bg-transparent border-none outline-none text-white placeholder-gray-500"
                  />
                </div>

                <div className="px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-300 text-sm flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  {autoInfo.systemToken ? "信息已自动获取" : "请手动填入 Access Token"}，点击保存即可完成添加
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('login')}
                  className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-lg font-semibold transition-all"
                >
                  重新登录
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <CheckCircle className="w-5 h-5" />
                  保存站点
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteEditorV2;