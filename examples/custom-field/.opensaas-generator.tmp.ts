
import config from './opensaas.config.ts';
import { writePrismaSchema, writeTypes } from '@opensaas/core';

writePrismaSchema(config, './prisma/schema.prisma');
writeTypes(config, './.opensaas/types.ts');
