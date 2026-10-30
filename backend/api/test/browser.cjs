// Uses only a dedicated *_test database; never run against a deployed database.
const { chromium, expect } = require(
  process.env.PLAYWRIGHT_MODULE || '@playwright/test',
);
const { Client } = require('pg');
const { randomUUID, createHash } = require('crypto');
const fs = require('fs');
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error(
    'TEST_DATABASE_URL must point to a dedicated *_test database',
  );
const baseURL = process.env.TEST_APP_ORIGIN || 'http://localhost:4201';
(async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    await db.query(
      'TRUNCATE tk_award_months,tk_winners,tk_votes,tk_messages,tk_rounds,tk_sessions,tk_oauth,tk_users CASCADE',
    );
    const users = [];
    for (const name of ['Alice', 'Bob']) {
      const id = randomUUID(),
        token = randomUUID();
      await db.query('INSERT INTO tk_users VALUES($1,$2,$3,$4)', [
        id,
        id,
        name + '@vicomtech.org',
        name,
      ]);
      await db.query(
        "INSERT INTO tk_sessions VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
        [createHash('sha256').update(token).digest('hex'), id, randomUUID()],
      );
      const ctx = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 1000 },
      });
      await ctx.addCookies([
        {
          name: 'tk_session',
          value: token,
          url: baseURL,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      users.push({ id, ctx, page });
    }
    const [alice, bob] = users;
    await Promise.all(users.map((u) => u.page.goto(baseURL)));
    await expect(
      alice.page.getByRole('heading', { name: 'La tontakery del día.' }),
    ).toBeVisible();
    await alice.page
      .locator('#phrase')
      .fill('Esta reunión podría haber sido un café.');
    await alice.page
      .getByRole('button', { name: 'Publicar', exact: true })
      .click();
    await alice.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Publicar', exact: true })
      .click();
    await expect(bob.page.locator('.message')).toContainText(
      'Esta reunión podría haber sido un café.',
    );
    await expect(bob.page.locator('.message')).not.toContainText('Alice');
    await expect(alice.page.locator('.message')).toContainText('Tu frase');
    await expect(alice.page.locator('#phrase')).toBeDisabled();
    await bob.page
      .getByRole('button', { name: 'Me gusta', exact: true })
      .click();
    await expect(
      bob.page.getByRole('button', { name: 'Tu voto', exact: true }),
    ).toBeVisible();
    const bobTab = await bob.ctx.newPage();
    await bobTab.goto(baseURL);
    await expect(
      bobTab.getByRole('button', { name: 'Tu voto', exact: true }),
    ).toBeVisible();
    await alice.ctx.setOffline(true);
    await bob.page
      .locator('#phrase')
      .fill('Mi código funciona. No sé por qué.');
    await bob.page
      .getByRole('button', { name: 'Publicar', exact: true })
      .click();
    await bob.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Publicar', exact: true })
      .click();
    await alice.ctx.setOffline(false);
    await expect(alice.page.locator('.message')).toHaveCount(2, {
      timeout: 15000,
    });
    await alice.page
      .getByRole('button', { name: 'Me gusta', exact: true })
      .click();
    await expect(
      alice.page.getByRole('button', { name: 'Tu voto', exact: true }),
    ).toBeVisible();
    fs.mkdirSync('test_reports', { recursive: true });
    await alice.page.screenshot({
      path: 'test_reports/chat-desktop.png',
      fullPage: true,
    });
    await alice.page.setViewportSize({ width: 390, height: 844 });
    await alice.page.screenshot({
      path: 'test_reports/chat-mobile.png',
      fullPage: true,
    });
    expect(
      await alice.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await db.query(
      "UPDATE tk_rounds SET ends_at=date_trunc('second',clock_timestamp())+interval '3 seconds' WHERE NOT closed",
    );
    await alice.page.reload();
    await expect(alice.page.locator('.winner-card')).toContainText('Alice', {
      timeout: 15000,
    });
    await expect(alice.page.locator('.winner-card')).toContainText('Bob');
    await expect(alice.page.locator('.composer-bottom')).toContainText(
      'Te quedan 2',
    );
    await expect(bob.page.locator('.messages .message')).toHaveCount(0);
    await alice.page
      .getByRole('button', { name: 'Ganadores', exact: true })
      .click();
    await expect(alice.page.locator('.history-card')).toContainText('Alice');
    await expect(alice.page.locator('.history-card')).toContainText('Bob');
    await alice.page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(
      alice.page.getByRole('link', { name: 'Entrar con Google' }),
    ).toBeVisible();
    await alice.page.setViewportSize({ width: 1440, height: 1000 });
    await alice.page.screenshot({
      path: 'test_reports/login-desktop.png',
      fullPage: true,
    });
    expect(errors).toEqual([]);
    console.log(
      'Browser checks passed: two sessions, anonymity, vote, reconnect, live close, tie bonus, history, logout, mobile overflow.',
    );
  } finally {
    await browser.close();
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
