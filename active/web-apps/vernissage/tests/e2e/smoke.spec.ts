import { expect, test } from 'playwright/test';

test('homepage renders both the revamped and classic shells and navigates to an artist page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Track the art you love.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up for free' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore the community' })).toHaveAttribute('href', '/search');
  await expect(page.getByRole('link', { name: 'Classic launch homepage' })).toHaveAttribute('href', '/?home=classic');
  await expect(page.getByText('Explore The Vernissage')).toBeVisible();
  await expect(page.getByText(/Version\s+(0\.1\.0|thinker-registry-20\d{6}-\d{6}|20\d{6,}|development|dev)/)).toBeVisible();

  await page.getByRole('link', { name: 'Classic launch homepage' }).click();

  await expect(page).toHaveURL(/\/?\?home=classic$/);
  await expect(page.getByText('An art review salon in emerald, gold, and parchment')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Write a review' })).toBeVisible();
  await expect(page.getByText('Current exhibitions')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Stacks of Wheat (End of Summer)' })).toHaveAttribute('href', '/artworks/stacks-of-wheat-end-of-summer');
  await expect(page.getByRole('link', { name: 'Claude Monet' }).first()).toHaveAttribute('href', '/artists/claude-monet');
  await expect(page.locator('.artist-row').filter({ has: page.getByRole('link', { name: 'Claude Monet' }) }).getByRole('link', { name: 'View Claude Monet' })).toHaveAttribute('href', '/artists/claude-monet');
  await expect(page.getByRole('link', { name: 'Visit the full writing feed' })).toHaveAttribute('href', '/feed');

  const recentWritingLinks = page.locator('.ordered-mini-list a');
  if (await recentWritingLinks.count()) {
    await expect(recentWritingLinks.first()).toHaveAttribute('href', /\/((artworks|artists|exhibitions)\/|feed$)/);
  } else {
    await expect(page.getByText('No member reviews have been published yet. The first real response will appear here once someone writes it.')).toBeVisible();
  }

  await page.getByRole('link', { name: 'View Stacks of Wheat (End of Summer)' }).click();
  await expect(page).toHaveURL(/\/artworks\/stacks-of-wheat-end-of-summer$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Stacks of Wheat (End of Summer)' })).toBeVisible();

  await page.goto('/?home=classic', { waitUntil: 'domcontentloaded' });

  await page.getByRole('link', { name: 'Claude Monet' }).first().click();

  await expect(page).toHaveURL(/\/artists\/claude-monet$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Claude Monet' })).toBeVisible();
  await expect(page.getByText('Artist dossier')).toBeVisible();
  await expect(page.getByText('Public favorite artists will appear on member pages once the shared application database is connected.')).toBeVisible();
});

test('search page links into the artwork detail page', async ({ page }) => {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Search by movement, medium, or keyword' })).toBeVisible();
  await expect(page.getByLabel('Search term')).toBeVisible();
  await page.getByLabel('Search term').fill('water lilies');
  await page.getByLabel('Year').selectOption('1906');
  await page.getByRole('button', { name: 'Search catalog' }).click();

  await expect(page).toHaveURL(/\/search\?/);
  const searchUrl = new URL(page.url());
  expect(searchUrl.searchParams.get('query')).toBe('water lilies');
  expect(searchUrl.searchParams.get('year')).toBe('1906');
  await expect(page.getByText('1 artwork match')).toBeVisible();

  const waterLiliesCard = page.locator('.artwork-preview-card').filter({
    has: page.getByRole('heading', { level: 3, name: 'Water Lilies' })
  });
  await waterLiliesCard.getByRole('link', { name: 'View artwork' }).click();

  await expect(page).toHaveURL(/\/artworks\/water-lilies-1906(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Water Lilies' })).toBeVisible();
  await expect(page.getByText('Reader responses')).toBeVisible();
  await expect(page.getByText('Public favorite artworks will appear on member pages once the shared application database is connected.')).toBeVisible();
  const artistDossierLink = page.getByRole('link', { name: 'View artist dossier' });
  await expect(artistDossierLink).toHaveAttribute('href', '/artists/claude-monet');
  await Promise.all([page.waitForURL(/\/artists\/claude-monet$/), artistDossierLink.click()]);
  await expect(page.getByText('Works by this artist')).toBeVisible();
});

test('member redirect and dossier-only artist route render without filler content', async ({ page }) => {
  await page.goto('/members/nonexistent-member', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole('heading', { level: 1, name: 'What Vernissage members are writing' })).toBeVisible();
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
  await expect(page.getByRole('heading', { level: 1, name: 'Nominate an artist Vernissage should focus on' })).toBeVisible();
  await expect(page.getByLabel('Artist name')).toBeVisible();
});

test('join page only asks for a handle and password', async ({ page }) => {
  await page.goto('/join', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'Take your place in the salon' })).toBeVisible();
  await expect(page.getByLabel('Handle')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByText('Start writing first. You can shape the rest of your profile after you are inside.')).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveCount(0);
  await expect(page.getByLabel('Location')).toHaveCount(0);
  await expect(page.getByLabel('Bio')).toHaveCount(0);
});

test('feedback updates page explains signed-in and anonymous tracking', async ({ page }) => {
  await page.goto('/feedback/updates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'See what happened after you sent a note' })).toBeVisible();
  await expect(page.getByText('Anonymous notes stay private and trackable through the one-off link returned at submission time.')).toBeVisible();
  await expect(page.getByText('Signed-in members can also come back here to see every note tied to their handle in one place.')).toBeVisible();
});
