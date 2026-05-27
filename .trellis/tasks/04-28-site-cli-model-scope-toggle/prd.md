# Site CLI Model Scope Toggle

## Goal
Adjust the site management CLI configuration so users can choose whether model selectors only show
models under the selected API key's user group or all models available in the site.

## Requirements
- Add a new option named `列出全部模型` near the `选择 API Key` control in site CLI config.
- When `列出全部模型` is off, only show models from the selected API key's owning user group.
- When `列出全部模型` is on, show all models available in the site.
- Let users pick from the filtered model list in both `测试使用模型` and `CLI 使用模型`.
- Preserve existing site CLI config behavior outside of the model list scope change.

## Acceptance Criteria
- [ ] Users can toggle `列出全部模型` in the site CLI config UI.
- [ ] `测试使用模型` options follow the toggle state.
- [ ] `CLI 使用模型` options follow the toggle state.
- [ ] With the toggle off, models from unrelated user groups are hidden.
- [ ] With the toggle on, all site models are available for selection.

## Technical Notes
- Expected scope is renderer/frontend unless current implementation stores this setting in shared
  config.
- Reuse existing site/API key/model derivation helpers if they already exist.
