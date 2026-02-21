export function buildClarificationReply(question: string): string {
  return question;
}

export function buildAmbiguityReply(
  inputRef: string,
  alternatives: Array<{ id: string; name: string }>,
): string {
  const lines = alternatives.map(
    (alt, i) => `  ${i + 1}. ${alt.name} (${alt.id})`,
  );
  return `Which "${inputRef}" did you mean?\n${lines.join("\n")}`;
}
