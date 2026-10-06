// The vendor client's bundled account catalog in its published ModelInfo objects.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/models-manager/models.json "gpt-5.4"
import catalog from '../../codex/spec/vendor/models-manager/models.json' with { type: 'json' };
export const codexCatalog = catalog.models;
