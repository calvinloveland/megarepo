import { expect, test } from 'playwright/test';

test('homepage renders the salon shell and navigates to an artist page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible();
  await expect(page.getByText('An art review salon in emerald, gold, and parchment')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Write a review' })).toBeVisible();
  await expect(page.getByText('Current exhibitions')).toBeVisible();
  await expect(page.getByText(/Version\s+(0\.1\.0|20\d{6,}|development|dev)/)).toBeVisible();

  await page.locator('a[href="/artists/claude-monet"]').click();

  await expect(page).toHaveURL(/\/artists\/claude-monet$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Claude Monet' })).toBeVisible();
  await expect(page.getByText('Artist dossier')).toBeVisible();
});

test('search page links into the artwork detail page', async ({ page }) => {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Search the current curated collection' })).toBeVisible();
  await expect(page.getByLabel('Search term')).toBeVisible();
  await page.getByLabel('Search term').fill('water lilies');
  await page.getByLabel('Year').selectOption('1906');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page).toHaveURL(/\/search\?/);
  const searchUrl = new URL(page.url());
  expect(searchUrl.searchParams.get('query')).toBe('water lilies');
  expect(searchUrl.searchParams.get('year')).toBe('1906');
  await expect(page.getByText('1 matching artworks')).toBeVisible();

  await page.locator('a[href="/artworks/water-lilies-1906"]').first().click();

  await expect(page).toHaveURL(/\/artworks\/water-lilies-1906(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Water Lilies' })).toBeVisible();
  await expect(page.getByText('Reader responses')).toBeVisible();
  await page.getByRole('link', { name: 'View artist dossier' }).click();
  await expect(page).toHaveURL(/\/artists\/claude-monet$/);
  await expect(page.getByText('Works by this artist')).toBeVisible();
});

test('member redirect and dossier-only artist route render without filler content', async ({ page }) => {
  await page.goto('/members/nonexistent-member', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Recent writing' })).toBeVisible();
  await expect(page.getByText('This page has slipped behind the curtain')).toHaveCount(0);

  await page.goto('/artists/ken-rockwell', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Ken Rockwell' })).toBeVisible();
  await expect(page.getByText('Works forthcoming')).toBeVisible();
  await expect(page.getByText('This page has slipped behind the curtain')).toHaveCount(0);
});

test('search page links to the artist request flow', async ({ page }) => {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });

  await page.getByRole('link', { name: 'Suggest an artist' }).first().click();

  await expect(page).toHaveURL(/\/artists\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Suggest an artist for Vernissage' })).toBeVisible();
  await expect(page.getByLabel('Artist name')).toBeVisible();
});

test('join page only asks for a handle and password', async ({ page }) => {
  await page.goto('/join', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Take your place in the salon' })).toBeVisible();
  await expect(page.getByLabel('Handle')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByText('No email confirmation loop, display-name prompt, location survey, or bio essay at signup.')).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveCount(0);
  await expect(page.getByLabel('Location')).toHaveCount(0);
  await expect(page.getByLabel('Bio')).toHaveCount(0);
});
