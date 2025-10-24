import config from './opensaas.config.ts'
import { writePrismaSchema, writeTypes, writeContext } from '@opensaas/framework-cli/generator'

writePrismaSchema(config, './prisma/schema.prisma')
writeTypes(config, './.opensaas/types.ts')
writeContext(config, './.opensaas/context.ts')
