# Juntos Web

Aplicação web responsiva do Juntos, conectada ao mesmo projeto Supabase usado pelo aplicativo Android.

## Recursos

- autenticação por e-mail e senha;
- recuperação de senha;
- casas compartilhadas e convites com validade;
- visão pessoal e visão do casal;
- contas, cartões, transações, orçamento e recorrências;
- tarefas, agenda e metas;
- PWA instalável no celular;
- políticas RLS para isolamento entre usuários e casas.

## Publicação

O site é estático e publicado pelo GitHub Pages por meio do workflow em `.github/workflows/pages.yml`.

URL esperada: `https://telagomidia.github.io/Juntos/`

## Segurança

O navegador utiliza apenas a chave pública do Supabase. Chaves `secret` e `service_role` nunca devem ser adicionadas ao repositório. A autorização real ocorre no PostgreSQL por meio de Row Level Security.

Antes de produção, mantenha no Supabase:

- confirmação de e-mail ativa;
- proteção contra senhas vazadas ativa;
- CAPTCHA para cadastro e recuperação de senha;
- URLs autorizadas restritas ao domínio publicado;
- revisão periódica do Security Advisor.

## Banco de dados

As alterações versionadas estão em `supabase/migrations/`.
