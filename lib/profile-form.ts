export function fieldDescribedBy(fieldId: string, error?: string) {
  return error ? `${fieldId}-error` : undefined;
}

export function focusFirstInvalid(fieldIds: string[]) {
  for (const id of fieldIds) {
    const node = document.getElementById(id);
    if (node) {
      node.focus();
      return;
    }
  }
}
