export type RegistrationSubmission = {
  name: string;
  handle: string;
  password: string;
  callbackUrl: string;
};

export const DEFAULT_CALLBACK_URL = '/reviews/new';
export const MIN_PASSWORD_LENGTH = 12;

function normalizeRegistrationHandle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

export function normalizeCallbackUrl(value: string | null | undefined) {
  const raw = value?.trim() ?? '';
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return DEFAULT_CALLBACK_URL;
  }

  return raw;
}

export function parseRegistrationSubmission(formData: FormData): { ok: true; value: RegistrationSubmission } | { ok: false; error: string } {
  const handle = normalizeRegistrationHandle(`${formData.get('handle') ?? ''}`);
  const password = `${formData.get('password') ?? ''}`;
  const callbackUrl = normalizeCallbackUrl(`${formData.get('callbackUrl') ?? DEFAULT_CALLBACK_URL}`);
  const name = handle;

  if (!handle || password.length < MIN_PASSWORD_LENGTH || handle.length < 3 || handle.length > 32) {
    return { ok: false, error: 'invalid' };
  }

  return {
    ok: true,
    value: {
      name,
      handle,
      password,
      callbackUrl
    }
  };
}
