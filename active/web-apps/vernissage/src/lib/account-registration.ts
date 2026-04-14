export type RegistrationSubmission = {
  name: string;
  handle: string;
  password: string;
  callbackUrl: string;
};

function normalizeRegistrationHandle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

export function parseRegistrationSubmission(formData: FormData): { ok: true; value: RegistrationSubmission } | { ok: false; error: string } {
  const rawName = `${formData.get('name') ?? ''}`.trim();
  const handle = normalizeRegistrationHandle(`${formData.get('handle') ?? ''}`);
  const password = `${formData.get('password') ?? ''}`;
  const callbackUrl = `${formData.get('callbackUrl') ?? '/reviews/new'}` || '/reviews/new';
  const name = rawName || handle;

  if (!handle || password.length < 10 || handle.length < 3 || handle.length > 32) {
    return { ok: false, error: 'invalid' };
  }

  if (name.length > 80) {
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
