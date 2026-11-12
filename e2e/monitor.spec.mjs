import { expect, test } from '@playwright/test';
test('exibe status público e restringe detalhes à sessão', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Status público' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver evento 1' })).toBeHidden();
  await page.getByLabel('Usuário').fill('qa');
  await page.getByLabel('Senha').fill('qa-monitor-e2e');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Ver evento 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('demo.health');
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Acesso aos logs' })).toBeVisible();
});
