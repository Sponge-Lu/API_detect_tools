type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

export function rectifyRejectedRequest(
  body: Buffer,
  status: number,
  rejection: Buffer
): { body: Buffer; kind: 'signature' | 'thinking' | 'opaque-state' } | undefined {
  if (![400, 422].includes(status)) return;
  const message = rejection.toString('utf8').slice(0, 16_384);
  const kind =
    /(?:invalid|invalidated|missing|mismatch|verification failed).*signature|signature.*(?:invalid|mismatch|verification failed)/i.test(
      message
    )
      ? 'signature'
      : /(?:thinking|budget_tokens).*(?:budget|must be|less than|greater than|not supported|unsupported|invalid)/i.test(
            message
          )
        ? 'thinking'
        : /(?:encrypted_content|encrypted agent task|opaque.state).*(?:invalid|reject|unsupported|not supported|decrypt)|(?:invalid|reject|unsupported|decrypt).*(?:encrypted_content|encrypted agent task|opaque.state)/i.test(
              message
            )
          ? 'opaque-state'
          : undefined;
  if (!kind) return;
  let parsed: RecordValue | undefined;
  try {
    parsed = record(JSON.parse(body.toString('utf8')));
  } catch {
    return;
  }
  if (!parsed) return;
  const before = JSON.stringify(parsed);
  if (kind === 'thinking') {
    delete parsed.thinking;
    delete parsed.reasoning_effort;
    delete parsed.reasoning;
  }
  const repairBlocks = (items: unknown[]): unknown[] =>
    items.flatMap(item => {
      const block = record(item);
      if (!block) return [item];
      if (kind === 'signature' && ['thinking', 'redacted_thinking'].includes(String(block.type))) {
        return block.type === 'thinking' && typeof block.thinking === 'string'
          ? [{ type: 'text', text: block.thinking }]
          : [];
      }
      if (
        kind === 'opaque-state' &&
        ['reasoning', 'compaction', 'encrypted_agent_task'].includes(String(block.type)) &&
        ('encrypted_content' in block || block.type === 'encrypted_agent_task')
      )
        return [];
      if (Array.isArray(block.content)) block.content = repairBlocks(block.content);
      return [block];
    });
  for (const field of ['messages', 'input']) {
    if (Array.isArray(parsed[field])) parsed[field] = repairBlocks(parsed[field] as unknown[]);
  }
  const after = JSON.stringify(parsed);
  return before === after ? undefined : { body: Buffer.from(after), kind };
}
