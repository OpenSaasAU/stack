---
description: Generate the opensaas.config.ts file for this project
---

Generate the opensaas.config.ts file for this project.

## Instructions

1. Read `.claude/opensaas-project.json` to get project details
2. If migration wizard hasn't been started, start it:
   ```
   opensaas_start_migration({ projectType: "<project_type>" })
   ```

3. Guide the user through any remaining questions

4. When complete, display:
   - The generated config file
   - Dependencies to install
   - Next steps to run

5. Offer to explain any part of the generated config

## Quick Mode

If the user wants defaults, use these answers based on the project metadata:
- preserve_database: true
- db_provider: [from project metadata]
- enable_auth: [from project metadata]
- default_access: "public-read-auth-write"
- admin_base_path: "/admin"
