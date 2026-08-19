export function describeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof Error) || !("cause" in error)) return message;

  const cause = error.cause;
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return causeMessage === "" || causeMessage === message ? message : `${message} (${causeMessage})`;
}
