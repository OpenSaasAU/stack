#!/usr/bin/env node
import { writeBuildHash } from './dist-freshness.mjs'

writeBuildHash(process.cwd())
