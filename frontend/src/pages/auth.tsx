import { KeyRound, LogIn } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
import { FieldGroup, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ActionForm, Field, SubmitButton } from '@/components/shared'
import type { PageData } from '@/lib/types'

export function AuthPage({ data, setup }: { data: PageData; setup: boolean }) {
  return (
    <FieldGroup className="gap-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <BrandMark className="mb-3 size-9" />
        <h1 className="text-2xl font-semibold">CaddyUI</h1>
        <FieldDescription>
          {setup ? '创建管理员账户' : '登录管理控制台'}
        </FieldDescription>
      </div>
      <ActionForm action={setup ? '/setup' : '/login'}>
        {setup && (
          <Field id="setup_token" label="初始化口令" hint="在服务器数据目录中读取 setup-token 文件；一键安装默认位于 /var/lib/caddyui/setup-token。">
            <Input id="setup_token" name="setup_token" type="password" autoComplete="off" required />
          </Field>
        )}
        <Field
          id="username"
          label="邮箱"
          hint={setup ? '同时用作 HTTPS 证书的联系邮箱。' : undefined}
        >
          <Input
            id="username"
            className="h-10"
            name="username"
            type={setup ? 'email' : 'text'}
            autoComplete="username"
            inputMode="email"
            defaultValue={data.Username}
            autoFocus
            required
            placeholder="you@example.com"
          />
        </Field>
        <Field id="password" label="密码">
          <Input
            id="password"
            className="h-10"
            name="password"
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            minLength={setup ? 8 : undefined}
            required
            placeholder={setup ? '至少 8 位' : ''}
          />
        </Field>
        {setup && (
          <Field id="confirm" label="确认密码">
            <Input
              id="confirm"
              className="h-10"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
        )}
        <SubmitButton className="h-10 w-full">
          {setup ? <KeyRound /> : <LogIn />}
          {setup ? '创建并登录' : '登录'}
        </SubmitButton>
      </ActionForm>
    </FieldGroup>
  )
}
