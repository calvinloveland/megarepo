import { expect, test } from 'playwright/test';

test('homepage renders the salon shell and navigates to an artist page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible();
  await expect(page.getByText('An art review salon in emerald, gold, and parchment')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Write a review' })).toBeVisible();
  await expect(page.getByText('Current exhibitions')).toBeVisible();

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
});

test('member and exhibition routes render without falling into not-found', async ({ page }) => {
  await page.goto('/members/aurelia-vale', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole('heading', { level: 1, name: 'The launch notebook' })).toBeVisible();
  await expect(page.getByText('This page has slipped behind the curtain')).toHaveCount(0);

  await page.goto('/exhibitions/light-and-color-revolution', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Light & Color: The Impressionist Revolution' })).toBeVisible();
  await expect(page.getByText('Featured works')).toBeVisible();
  await expect(page.getByText('This page has slipped behind the curtain')).toHaveCount(0);
});

test('search page exposes catalog request feedback flow', async ({ page }) => {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });

  await page.getByText('Request an artist or artwork').click();

  await expect(page.getByRole('dialog', { name: 'Send feedback' })).toBeVisible();
  await expect(page.getByLabel('Your feedback')).toHaveValue(/I'd love to request an artist or artwork/);
});
