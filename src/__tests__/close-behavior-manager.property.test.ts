/**
 * 输入: 模拟的关闭行为设置参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - 关闭行为管理器的属性测试，验证设置持久化逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: window-close-behavior**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
 * - Property 2: Preference persistence round-trip
 * - Property 4: Dialog appears only when behavior is 'ask'
 * - Property 5: Settings panel reflects current preference
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============= Types =============

type CloseBehavior = 'ask' | 'quit' | 'minimize';

interface CloseBehaviorSettings {
  behavior: CloseBehavior;
}

interface CloseBehaviorSettingsFile {
  behavior: CloseBehavior;
  version: string;
}

// ============= 纯函数实现（从 close-behavior-manager.ts 提取的核心逻辑） =============

const DEFAULT_SETTINGS: CloseBehaviorSettingsFile = {
  behavior: 'ask',
  version: '1.0',
};

/**
 * 验证行为值是否有效
 */
function isValidBehavior(behavior: unknown): behavior is CloseBehavior {
  return behavior === 'ask' || behavior === 'quit' || behavior === 'minimize';
}

/**
 * 加载设置文件
 */
function loadSettings(settingsPath: string): CloseBehaviorSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const parsed: CloseBehaviorSettingsFile = JSON.parse(data);
      if (isValidBehavior(parsed.behavior)) {
        return { behavior: parsed.behavior };
      }
    }
  } catch {
    // 加载失败，使用默认值
  }
  return { behavior: DEFAULT_SETTINGS.behavior };
}

/**
 * 保存设置文件
 */
function saveSettings(settingsPath: string, settings: CloseBehaviorSettings): void {
  if (!isValidBehavior(settings.behavior)) {
    throw new Error(`Invalid behavior: ${settings.behavior}`);
  }

  const fileData: CloseBehaviorSettingsFile = {
    behavior: settings.behavior,
    version: '1.0',
  };

  fs.writeFileSync(settingsPath, JSON.stringify(fileData, null, 2), 'utf-8');
}

// ============= Arbitraries =============

/**
 * 生成有效的关闭行为值
 */
const closeBehaviorArb: fc.Arbitrary<CloseBehavior> = fc.oneof(
  fc.constant('ask' as CloseBehavior),
  fc.constant('quit' as CloseBehavior),
  fc.constant('minimize' as CloseBehavior)
);

/**
 * 生成有效的关闭行为设置
 */
const closeBehaviorSettingsArb: fc.Arbitrary<CloseBehaviorSettings> = fc.record({
  behavior: closeBehaviorArb,
});

/**
 * 生成无效的行为值
 */
const invalidBehaviorArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('invalid'),
  fc.constant('exit'),
  fc.constant('close'),
  fc.constant(123),
  fc.constant(true),
  fc.constant([]),
  fc.constant({})
);

/**
 * 生成损坏的设置文件内容
 */
const corruptedSettingsArb = fc.oneof(
  fc.constant(''),
  fc.constant('not json'),
  fc.constant('{}'),
  fc.constant('{"behavior": "invalid"}'),
  fc.constant('{"version": "1.0"}'),
  fc.constant(null),
  fc.json().filter(j => {
    try {
      const parsed = JSON.parse(j);
      return !isValidBehavior(parsed?.behavior);
    } catch {
      return true;
    }
  })
);

// ============= Test Helpers =============

let testDir: string;
let testSettingsPath: string;

function createTestDir(): void {
  testDir = path.join(
    os.tmpdir(),
    `close-behavior-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(testDir, { recursive: true });
  testSettingsPath = path.join(testDir, 'close-behavior-settings.json');
}

function cleanupTestDir(): void {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// ============= Property Tests =============

describe('Close Behavior Manager Property Tests', () => {
  beforeEach(() => {
    createTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  /**
   * **Property 2: Preference persistence round-trip**
   * **Validates: Requirements 1.5, 3.4, 3.5, 4.3**
   *
   * *For any* valid close behavior setting, saving the setting and then loading it
   * SHALL return the same value.
   */
  describe('Property 2: Preference persistence round-trip', () => {
    it('should preserve behavior setting after save and load round-trip', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, settings => {
          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 加载设置
          const loaded = loadSettings(testSettingsPath);

          // 验证加载的设置与原始设置一致
          expect(loaded.behavior).toBe(settings.behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve all valid behavior values', () => {
      fc.assert(
        fc.property(closeBehaviorArb, behavior => {
          const settings: CloseBehaviorSettings = { behavior };

          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 加载设置
          const loaded = loadSettings(testSettingsPath);

          // 验证行为值被正确保存和加载
          expect(loaded.behavior).toBe(behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle multiple save operations (idempotence)', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, settings => {
          // 保存两次相同的设置
          saveSettings(testSettingsPath, settings);
          saveSettings(testSettingsPath, settings);

          // 加载设置
          const loaded = loadSettings(testSettingsPath);

          // 验证结果一致
          expect(loaded.behavior).toBe(settings.behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle sequential saves with different values', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, closeBehaviorSettingsArb, (settings1, settings2) => {
          // 保存第一个设置
          saveSettings(testSettingsPath, settings1);
          const loaded1 = loadSettings(testSettingsPath);
          expect(loaded1.behavior).toBe(settings1.behavior);

          // 保存第二个设置
          saveSettings(testSettingsPath, settings2);
          const loaded2 = loadSettings(testSettingsPath);
          expect(loaded2.behavior).toBe(settings2.behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should return default value when settings file does not exist', () => {
      // 确保文件不存在
      if (fs.existsSync(testSettingsPath)) {
        fs.unlinkSync(testSettingsPath);
      }

      const loaded = loadSettings(testSettingsPath);
      expect(loaded.behavior).toBe('ask');
    });

    it('should return default value when settings file is corrupted', () => {
      fc.assert(
        fc.property(corruptedSettingsArb, corruptedContent => {
          // 写入损坏的内容
          if (corruptedContent !== null) {
            fs.writeFileSync(testSettingsPath, String(corruptedContent), 'utf-8');
          }

          // 加载设置应该返回默认值
          const loaded = loadSettings(testSettingsPath);
          expect(loaded.behavior).toBe('ask');
        }),
        { numRuns: 100 }
      );
    });

    it('should reject invalid behavior values when saving', () => {
      fc.assert(
        fc.property(invalidBehaviorArb, invalidBehavior => {
          const invalidSettings = { behavior: invalidBehavior as CloseBehavior };

          // 保存无效设置应该抛出错误
          expect(() => saveSettings(testSettingsPath, invalidSettings)).toThrow();
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve version field in settings file', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, settings => {
          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 直接读取文件内容
          const fileContent = fs.readFileSync(testSettingsPath, 'utf-8');
          const parsed = JSON.parse(fileContent);

          // 验证版本字段存在
          expect(parsed.version).toBe('1.0');
          expect(parsed.behavior).toBe(settings.behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle settings file with extra fields gracefully', () => {
      fc.assert(
        fc.property(
          closeBehaviorArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer(),
          (behavior, extraString, extraNumber) => {
            // 写入带有额外字段的设置文件
            const fileData = {
              behavior,
              version: '1.0',
              extraField: extraString,
              anotherField: extraNumber,
            };
            fs.writeFileSync(testSettingsPath, JSON.stringify(fileData, null, 2), 'utf-8');

            // 加载设置应该正常工作
            const loaded = loadSettings(testSettingsPath);
            expect(loaded.behavior).toBe(behavior);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle concurrent-like save operations', () => {
      fc.assert(
        fc.property(
          fc.array(closeBehaviorSettingsArb, { minLength: 2, maxLength: 10 }),
          settingsArray => {
            // 模拟多次保存操作
            for (const settings of settingsArray) {
              saveSettings(testSettingsPath, settings);
            }

            // 最后一次保存的值应该被保留
            const loaded = loadSettings(testSettingsPath);
            const lastSettings = settingsArray[settingsArray.length - 1];
            expect(loaded.behavior).toBe(lastSettings.behavior);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 4: Dialog appears only when behavior is 'ask'**
   * **Validates: Requirements 1.1, 3.1**
   *
   * *For any* close event, the close behavior dialog SHALL appear if and only if
   * the saved preference is 'ask' or no preference exists.
   */
  describe('Property 4: Dialog appears only when behavior is ask', () => {
    /**
     * 判断是否应该显示对话框的纯函数
     * 这是从 close-behavior-manager.ts 中 handleClose 方法提取的核心逻辑
     */
    function shouldShowDialog(settings: CloseBehaviorSettings | null): boolean {
      // 如果没有设置或设置为 'ask'，则显示对话框
      if (!settings || settings.behavior === 'ask') {
        return true;
      }
      return false;
    }

    it('should show dialog when behavior is ask', () => {
      fc.assert(
        fc.property(fc.constant('ask' as CloseBehavior), behavior => {
          const settings: CloseBehaviorSettings = { behavior };
          expect(shouldShowDialog(settings)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should NOT show dialog when behavior is quit', () => {
      fc.assert(
        fc.property(fc.constant('quit' as CloseBehavior), behavior => {
          const settings: CloseBehaviorSettings = { behavior };
          expect(shouldShowDialog(settings)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should NOT show dialog when behavior is minimize', () => {
      fc.assert(
        fc.property(fc.constant('minimize' as CloseBehavior), behavior => {
          const settings: CloseBehaviorSettings = { behavior };
          expect(shouldShowDialog(settings)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('should show dialog when settings is null (no preference exists)', () => {
      expect(shouldShowDialog(null)).toBe(true);
    });

    it('should show dialog if and only if behavior is ask or no preference', () => {
      fc.assert(
        fc.property(closeBehaviorArb, behavior => {
          const settings: CloseBehaviorSettings = { behavior };
          const shouldShow = shouldShowDialog(settings);

          // 对话框应该显示当且仅当 behavior 是 'ask'
          if (behavior === 'ask') {
            expect(shouldShow).toBe(true);
          } else {
            expect(shouldShow).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly determine dialog visibility after loading settings', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, settings => {
          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 加载设置
          const loaded = loadSettings(testSettingsPath);

          // 验证对话框显示逻辑
          const shouldShow = shouldShowDialog(loaded);

          if (loaded.behavior === 'ask') {
            expect(shouldShow).toBe(true);
          } else {
            expect(shouldShow).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should show dialog when settings file does not exist', () => {
      // 确保文件不存在
      if (fs.existsSync(testSettingsPath)) {
        fs.unlinkSync(testSettingsPath);
      }

      // 加载设置（应该返回默认值 'ask'）
      const loaded = loadSettings(testSettingsPath);

      // 默认行为是 'ask'，所以应该显示对话框
      expect(shouldShowDialog(loaded)).toBe(true);
    });

    it('should show dialog when settings file is corrupted', () => {
      fc.assert(
        fc.property(corruptedSettingsArb, corruptedContent => {
          // 写入损坏的内容
          if (corruptedContent !== null) {
            fs.writeFileSync(testSettingsPath, String(corruptedContent), 'utf-8');
          }

          // 加载设置（应该返回默认值 'ask'）
          const loaded = loadSettings(testSettingsPath);

          // 默认行为是 'ask'，所以应该显示对话框
          expect(shouldShowDialog(loaded)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 5: Settings panel reflects current preference**
   * **Validates: Requirements 4.2**
   *
   * *For any* saved close behavior preference, the settings panel SHALL display
   * that preference as the selected option.
   */
  describe('Property 5: Settings panel reflects current preference', () => {
    /**
     * 模拟设置面板的状态管理逻辑
     * 这是从 SettingsPanel.tsx 中提取的核心逻辑
     */
    interface SettingsPanelState {
      closeBehavior: CloseBehavior;
      loading: boolean;
    }

    /**
     * 模拟加载设置到面板状态
     */
    function loadSettingsToPanel(settingsPath: string): SettingsPanelState {
      const settings = loadSettings(settingsPath);
      return {
        closeBehavior: settings.behavior,
        loading: false,
      };
    }

    /**
     * 验证面板状态是否正确反映设置
     */
    function panelReflectsSettings(
      panelState: SettingsPanelState,
      expectedBehavior: CloseBehavior
    ): boolean {
      return panelState.closeBehavior === expectedBehavior && !panelState.loading;
    }

    it('should reflect saved preference in panel state', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, settings => {
          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 加载到面板状态
          const panelState = loadSettingsToPanel(testSettingsPath);

          // 验证面板状态正确反映设置
          expect(panelReflectsSettings(panelState, settings.behavior)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reflect all valid behavior values correctly', () => {
      fc.assert(
        fc.property(closeBehaviorArb, behavior => {
          const settings: CloseBehaviorSettings = { behavior };

          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 加载到面板状态
          const panelState = loadSettingsToPanel(testSettingsPath);

          // 验证面板状态与保存的行为一致
          expect(panelState.closeBehavior).toBe(behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should reflect default value when no settings exist', () => {
      // 确保文件不存在
      if (fs.existsSync(testSettingsPath)) {
        fs.unlinkSync(testSettingsPath);
      }

      // 加载到面板状态
      const panelState = loadSettingsToPanel(testSettingsPath);

      // 默认值应该是 'ask'
      expect(panelState.closeBehavior).toBe('ask');
    });

    it('should reflect default value when settings file is corrupted', () => {
      fc.assert(
        fc.property(corruptedSettingsArb, corruptedContent => {
          // 写入损坏的内容
          if (corruptedContent !== null) {
            fs.writeFileSync(testSettingsPath, String(corruptedContent), 'utf-8');
          }

          // 加载到面板状态
          const panelState = loadSettingsToPanel(testSettingsPath);

          // 应该显示默认值 'ask'
          expect(panelState.closeBehavior).toBe('ask');
        }),
        { numRuns: 100 }
      );
    });

    it('should update panel state when settings change', () => {
      fc.assert(
        fc.property(closeBehaviorSettingsArb, closeBehaviorSettingsArb, (settings1, settings2) => {
          // 保存第一个设置
          saveSettings(testSettingsPath, settings1);
          const panelState1 = loadSettingsToPanel(testSettingsPath);
          expect(panelState1.closeBehavior).toBe(settings1.behavior);

          // 保存第二个设置
          saveSettings(testSettingsPath, settings2);
          const panelState2 = loadSettingsToPanel(testSettingsPath);
          expect(panelState2.closeBehavior).toBe(settings2.behavior);
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly map behavior to radio button selection', () => {
      /**
       * 模拟单选按钮选中状态的计算逻辑
       * 这是 SettingsPanel.tsx 中 checked={closeBehavior === 'xxx'} 的逻辑
       */
      function getRadioButtonStates(currentBehavior: CloseBehavior): {
        askChecked: boolean;
        quitChecked: boolean;
        minimizeChecked: boolean;
      } {
        return {
          askChecked: currentBehavior === 'ask',
          quitChecked: currentBehavior === 'quit',
          minimizeChecked: currentBehavior === 'minimize',
        };
      }

      fc.assert(
        fc.property(closeBehaviorArb, behavior => {
          const settings: CloseBehaviorSettings = { behavior };

          // 保存设置
          saveSettings(testSettingsPath, settings);

          // 加载到面板状态
          const panelState = loadSettingsToPanel(testSettingsPath);

          // 获取单选按钮状态
          const radioStates = getRadioButtonStates(panelState.closeBehavior);

          // 验证只有一个单选按钮被选中
          const checkedCount = [
            radioStates.askChecked,
            radioStates.quitChecked,
            radioStates.minimizeChecked,
          ].filter(Boolean).length;
          expect(checkedCount).toBe(1);

          // 验证正确的单选按钮被选中
          if (behavior === 'ask') {
            expect(radioStates.askChecked).toBe(true);
          } else if (behavior === 'quit') {
            expect(radioStates.quitChecked).toBe(true);
          } else if (behavior === 'minimize') {
            expect(radioStates.minimizeChecked).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain consistency between saved settings and panel display', () => {
      fc.assert(
        fc.property(
          fc.array(closeBehaviorSettingsArb, { minLength: 1, maxLength: 10 }),
          settingsArray => {
            // 模拟多次设置更改
            for (const settings of settingsArray) {
              saveSettings(testSettingsPath, settings);

              // 每次保存后，面板状态应该与保存的设置一致
              const panelState = loadSettingsToPanel(testSettingsPath);
              expect(panelState.closeBehavior).toBe(settings.behavior);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
