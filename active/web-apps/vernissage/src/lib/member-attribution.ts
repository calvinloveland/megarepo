const editorialMemberHandles = new Set(['aurelia-vale', 'jonah-ivey', 'lucien-march']);

export const NOTEBOOK_LABEL = 'Vernissage Notebook';

export function isEditorialMemberHandle(handle: string) {
  return editorialMemberHandles.has(handle);
}

export function getMemberAttributionLabel(handle: string) {
  return isEditorialMemberHandle(handle) ? NOTEBOOK_LABEL : handle;
}

export function formatMemberAttribution(handle: string, suffix: string) {
  return `${getMemberAttributionLabel(handle)} · ${suffix}`;
}
