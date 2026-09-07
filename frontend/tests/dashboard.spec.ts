import { expect, test } from '@playwright/test'

test('React dashboard preserves account, site and configuration workflows', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.url().includes('/assets/') && response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`)
  })
  const password = 'TestPassword123!'
  await page.goto('/')
  await expect(page.getByText('创建管理员账户')).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByLabel('确认密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '创建并登录' }).click()
  await expect(page.getByRole('heading', { name: '站点概览' })).toBeVisible()
  await expect(page.getByText('暂无站点')).toBeVisible()
  await expect(page.locator('footer')).toHaveText('CaddyUI 1.0.0')

  await page.getByRole('link', { name: '添加站点' }).first().click()
  await expect(page.getByRole('dialog', { name: '添加站点' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).toHaveURL(/\/sites$/)
  await page.getByRole('link', { name: '添加站点' }).first().click()
  await expect(page.getByRole('dialog', { name: '添加站点' })).toBeVisible()
  await page.getByLabel('备注', { exact: true }).fill('discard new draft')
  await page
    .locator('[data-slot="dialog-overlay"]')
    .click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).toHaveURL(/\/sites$/)

  for (const [domain, port] of [
    ['app.example.com', '3000'],
    ['api.example.com', '8080'],
    ['docs.example.com', '4000'],
  ]) {
    await page.getByRole('link', { name: '添加站点' }).first().click()
    await expect(page.getByRole('dialog', { name: '添加站点' })).toBeVisible()
    await expect(page.getByLabel('备注', { exact: true })).toBeVisible()
    await page.getByLabel('域名', { exact: true }).fill(domain)
    if (domain === 'app.example.com') {
      await page.getByRole('button', { name: '保存并生效' }).click()
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
        '请填写端口',
      )
      await expect(page.getByLabel('域名', { exact: true })).toHaveValue(domain)
      await page.screenshot({
        path: testInfo.outputPath('add-site-dialog-desktop.png'),
        animations: 'disabled',
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: '高级选项', exact: true }).click()
      await page.getByLabel('备注', { exact: true }).fill('modal draft')
      await expect(
        page.getByRole('button', { name: '高级选项', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true')
      await page.screenshot({
        path: testInfo.outputPath('add-site-dialog-mobile.png'),
        animations: 'disabled',
      })
      const bounds = await page.getByRole('dialog').boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(15)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
      await page.getByLabel('备注', { exact: true }).fill('')
      await page.getByRole('button', { name: '高级选项', exact: true }).click()
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.getByRole('spinbutton', { name: '上游端口' }).fill(port)
    await page.getByRole('button', { name: '保存并生效' }).click()
    await expect(
      page.getByRole('row', { name: domain, exact: true }),
    ).toBeVisible()
  }
  await expect(page.getByLabel('站点统计').locator('strong')).toHaveText([
    '3',
    '3',
    '3',
    '已连接',
  ])
  await page.getByLabel('搜索站点').fill('api')
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(1)
  await page.getByLabel('搜索站点').fill('nothing-matches')
  await expect(page.getByText('没有匹配的站点')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await page.getByRole('switch', { name: '启用站点 api.example.com' }).click()
  await expect(
    page.getByRole('switch', { name: '启用站点 api.example.com' }),
  ).not.toBeChecked()
  await page.getByRole('combobox', { name: '站点状态' }).click()
  await page.getByRole('option', { name: '已停用' }).click()
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(1)
  await page.getByRole('combobox', { name: '站点状态' }).click()
  await page.getByRole('option', { name: '全部状态' }).click()
  await page
    .getByRole('link', { name: '编辑 app.example.com', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: '编辑站点' })).toBeVisible()
  await page.getByLabel('备注', { exact: true }).fill('discard edit draft')
  await page
    .locator('[data-slot="dialog-overlay"]')
    .click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).toHaveURL(/\/sites$/)
  await page
    .getByRole('link', { name: '编辑 app.example.com', exact: true })
    .click()
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('备注', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '刷新证书', exact: true }),
  ).not.toBeVisible()
  await page.getByRole('button', { name: '高级选项', exact: true }).click()
  await expect(page.getByLabel('域名', { exact: true })).toHaveValue(
    'app.example.com',
  )
  await expect(page.getByText('尚未发现证书', { exact: true })).toBeVisible()
  await page.getByRole('spinbutton', { name: '上游端口' }).fill('3333')
  await request.get('http://127.0.0.1:12029/test/issue-certificate')
  await page.getByRole('button', { name: '刷新证书', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '复制证书路径', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '上游端口' })).toHaveValue(
    '3333',
  )
  const certResponse = await (
    await page.request.get('/sites/1/certificates')
  ).json()
  expect(certResponse.Certs[0].Found).toBe(true)
  expect(JSON.stringify(certResponse)).not.toContain('test private key')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: '复制证书路径', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(certResponse.Certs[0].CertPath)
  await page.getByRole('button', { name: '复制私钥路径', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(certResponse.Certs[0].KeyPath)
  await page.screenshot({
    path: testInfo.outputPath('edit-dialog-certificates.png'),
    animations: 'disabled',
  })
  await page.getByLabel('备注', { exact: true }).fill('应用服务')
  await page.getByLabel('访问密码 · 用户名', { exact: true }).fill('viewer')
  await page
    .getByLabel('访问密码 · 密码', { exact: true })
    .fill('SitePassword!')
  await page.getByRole('button', { name: '高级选项', exact: true }).click()
  await expect(page.getByLabel('备注', { exact: true })).toBeVisible()
  await expect(
    page.getByLabel('访问密码 · 用户名', { exact: true }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: '刷新证书', exact: true }),
  ).not.toBeVisible()
  await page.getByRole('button', { name: '保存并生效' }).click()
  await expect(page.getByText('应用服务', { exact: true })).toBeVisible()
  const data = await (
    await page.request.get('/sites', {
      headers: { Accept: 'application/json' },
    })
  ).json()
  expect(JSON.stringify(data)).not.toContain('BasicHash')
  expect(
    data.data.Sites.find(
      (site: { Domains: string }) => site.Domains === 'app.example.com',
    ).HasBasicAuth,
  ).toBe(true)

  await page
    .getByRole('button', { name: '删除 docs.example.com', exact: true })
    .click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  const cleanup = page.getByRole('checkbox', {
    name: '同时清理该站点独占的证书、私钥和元数据',
  })
  await expect(cleanup).not.toBeChecked()
  await cleanup.check()
  await page.screenshot({
    path: testInfo.outputPath('delete-site-desktop.png'),
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: testInfo.outputPath('delete-site-mobile.png'),
    animations: 'disabled',
  })
  const deleteBounds = await page.getByRole('alertdialog').boundingBox()
  expect(deleteBounds!.x).toBeGreaterThanOrEqual(0)
  expect(deleteBounds!.x + deleteBounds!.width).toBeLessThanOrEqual(390)
  expect(deleteBounds!.y + deleteBounds!.height).toBeLessThanOrEqual(844)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(3)
  await page
    .getByRole('button', { name: '删除 docs.example.com', exact: true })
    .click()
  await expect(cleanup).not.toBeChecked()
  await cleanup.check()
  const deletion = page.waitForRequest(
    (request) =>
      request.url().endsWith('/sites/3/delete') && request.method() === 'POST',
  )
  await page.getByRole('button', { name: '确认', exact: true }).click()
  expect(
    new URLSearchParams((await deletion).postData() || '').get('cleanup_certs'),
  ).toBe('1')
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(2)

  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute(
    'data-state',
    'collapsed',
  )
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute(
    'data-state',
    'expanded',
  )
  await page.getByRole('link', { name: '配置管理', exact: true }).click()
  await expect(page.getByRole('tab', { name: '当前配置' })).toBeVisible()
  await page.getByRole('button', { name: '重新下发' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '配置已重新下发并生效' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: /历史版本/ }).click()
  await page.getByRole('button', { name: '回滚', exact: true }).first().click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '已回滚到版本' }),
  ).toBeVisible()
  await request.get('http://127.0.0.1:12029/test/reject')
  await page.getByRole('button', { name: '重新下发' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: '下发失败' }),
  ).toBeVisible()
  await request.get('http://127.0.0.1:12029/test/accept')

  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height })
    for (const route of [
      '/sites',
      '/sites/new',
      '/sites/1/edit',
      '/config',
      '/settings',
    ]) {
      await page.goto(route)
      await expect(page.locator('main h1')).toBeVisible()
      if (route === '/sites/new' || route === '/sites/1/edit') {
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await dialog
          .getByRole('button', { name: '高级选项', exact: true })
          .click()
        const viewport = dialog.locator('[data-slot="scroll-area-viewport"]')
        await expect(viewport).toBeVisible()
        await expect
          .poll(() =>
            viewport.evaluate((element) => {
              element.scrollTop = element.scrollHeight
              return element.scrollTop
            }),
          )
          .toBeGreaterThan(0)
        const bounds = await dialog.boundingBox()
        expect(bounds!.y).toBeGreaterThanOrEqual(0)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height)
        expect(
          await viewport.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true)
        if (route === '/sites/1/edit') {
          await dialog
            .getByRole('button', { name: '复制私钥路径', exact: true })
            .scrollIntoViewIfNeeded()
          await expect(
            dialog.getByRole('button', { name: '复制证书路径', exact: true }),
          ).toBeVisible()
          await expect(
            dialog.getByRole('button', { name: '复制私钥路径', exact: true }),
          ).toBeVisible()
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${width}.png`),
        fullPage: true,
      })
    }
  }
  await page.goto('/sites')
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('link', { name: '配置管理', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '配置管理', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: '切换浅色主题', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.goto('/sites')
  await expect(page.getByRole('heading', { name: '站点概览' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('light-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({
    path: testInfo.outputPath('light-desktop.png'),
    fullPage: true,
  })

  await page.goto('/settings')
  await page
    .getByLabel('自定义 ACME 目录', { exact: true })
    .fill('https://acme-staging-v02.api.letsencrypt.org/directory')
  await page.getByRole('button', { name: '保存证书设置', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '证书设置已保存并生效' }),
  ).toBeVisible()
  await page.getByLabel('当前密码', { exact: true }).fill(password)
  await page.getByLabel('新密码', { exact: true }).fill(password + 'new')
  await page.getByLabel('确认新密码', { exact: true }).fill(password + 'new')
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await expect(page.getByText('登录管理控制台')).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('邮箱或密码错误')
  await page.getByLabel('密码', { exact: true }).fill(password + 'new')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '站点概览' })).toBeVisible()
  await page.getByRole('button', { name: /管理员/ }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByText('登录管理控制台')).toBeVisible()
  await page.goto('/sites')
  await expect(page.getByText('登录管理控制台')).toBeVisible()
  for (const dark of [true, false]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value),
      dark,
    )
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await expect(
        page.getByRole('button', { name: '登录', exact: true }),
      ).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(
          `login-${dark ? 'dark' : 'light'}-${width}.png`,
        ),
        fullPage: true,
      })
    }
  }
  expect(errors).toEqual([])
})
