# OpenSaaS App Builder Skill

**When to invoke**: User describes wanting to build an application or add functionality to their OpenSaaS Stack app

## Pattern Recognition

Invoke this skill when you detect:

- "I want to build/create an app that..."
- "I need to add [functionality] to my app"
- "How do I implement [feature]"
- "Can you help me build [application description]"
- User describing business requirements or use cases

## What This Skill Does

This skill transforms application requirements into concrete OpenSaaS feature implementations by:

1. **Understanding the use case** through targeted clarifying questions
2. **Mapping requirements to features** (both built-in and custom)
3. **Implementing features systematically** using MCP wizards
4. **Generating production-ready code** with proper access control and best practices

## Process Flow

### Step 1: Requirements Discovery

Ask clarifying questions to understand:

- **Users & Auth**: Do they need user accounts? Roles? OAuth?
- **Data Model**: What entities/lists are needed?
- **Relationships**: How do entities relate to each other?
- **Permissions**: Who can do what? Public vs. authenticated access?
- **Content**: Rich text, files, images needed?
- **Social**: Comments, likes, sharing?
- **Search**: Do they need to find/filter content?

### Step 2: Feature Identification

Map their needs to OpenSaaS features:

**Built-in Features** (use `opensaas_implement_feature`):

- User accounts → `authentication`
- Content with authors → `blog` (adaptable to many content types)
- Discussions → `comments`
- Files/images → `file-upload`
- Finding content → `semantic-search`

**Custom Features** (use `opensaas_implement_feature` with `feature: "custom"`):

- Domain-specific data models
- Business logic and workflows
- Specialized relationships
- Custom access patterns

### Step 3: Implementation Order

Implement features in dependency order:

1. **Authentication first** (if needed) - foundation for access control
2. **Core data model** - main entities and relationships
3. **Content features** - blog, files, etc.
4. **Enhancement features** - comments, search, etc.

For each feature:

- Call `opensaas_implement_feature` with the feature ID
- Guide user through wizard questions naturally
- Call `opensaas_answer_feature` with their responses
- Handle follow-up questions via `opensaas_answer_followup`
- Explain the generated code and next steps

### Step 4: Integration & Validation

After implementing all features:

- Ensure features work together (e.g., blog posts reference User)
- Validate access control is properly configured
- Guide through database migration (`pnpm generate`, `pnpm db:push`)
- Help test the implementation

## Example: Food Tracking App

**User**: "I want to create an app that tracks food consumption"

**Clarifying Questions**:

1. "Will users need individual accounts to track their own food?"
   - → Yes = `authentication` feature needed
2. "How do users log food - select from database or enter freely?"
   - → Database = need `Food` list
   - → Free entry = simpler `FoodLog` list
3. "Do you want to track nutritional information?"
   - → Yes = add nutrition fields to Food/FoodLog
4. "Any social features like sharing meals or following friends?"
   - → Yes = could use `comments` or custom social features

**Feature Mapping**:

- User accounts with roles → `authentication` feature
- Food database → Custom `Food` list with nutrition data
- Food logging → Custom `FoodLog` list with relationships
- Optional: Meal planning → Custom `MealPlan` list

**Implementation**:

```typescript
// 1. Implement authentication
opensaas_implement_feature({ feature: 'authentication' })
// Guide through: email/password, no special roles, basic profile

// 2. Implement custom food database
opensaas_implement_feature({
  feature: 'custom',
  description:
    'Food database with nutritional information (calories, protein, carbs, fats, serving size)',
})

// 3. Implement food logging
opensaas_implement_feature({
  feature: 'custom',
  description:
    'Food log entries where users can record meals with foods, quantities, and timestamps',
})
```

## Guidelines for Success

### Be Conversational

- Don't interrogate - have a natural dialogue
- Explain why you're asking questions
- Offer suggestions based on common patterns

### Think Holistically

- Consider the complete app, not isolated features
- Identify relationships between features
- Ensure access control makes sense across all features

### Generate Complete Solutions

- Use wizards for complete implementations
- Provide all necessary code (config, UI, access control)
- Include testing and validation steps

### Follow OpenSaaS Patterns

- PascalCase for list names in config
- Always use `context.db`, never direct Prisma
- Define access control for every operation
- Use typed field builders
- Include hooks for business logic

### Educate as You Build

- Explain the generated code
- Point out OpenSaaS patterns being used
- Reference documentation with `opensaas_feature_docs`
- Help them understand maintainability

## Success Criteria

✅ User clearly understands what you're building
✅ All required features identified and implemented
✅ Generated code follows OpenSaaS best practices
✅ Access control properly configured
✅ Features integrate correctly
✅ User knows how to test and iterate

## Common Scenarios

### Blog/Content Platform

Authentication + Blog feature (customize for their content type)

### E-commerce

Authentication + Custom Product/Order lists + File Upload (product images)

### Task/Project Management

Authentication + Custom Project/Task lists with relationships

### Community/Forum

Authentication + Custom Topic/Post lists + Comments

### Dashboard/Analytics

Authentication + Custom metrics/data lists + potentially Search

For each scenario, adapt the wizard questions to their specific needs!

## Reporting Issues

**When you encounter bugs or missing features in OpenSaaS Stack:**

If while building the application you discover:

- Bugs in OpenSaaS Stack packages
- Missing features that the user needs
- Documentation gaps or errors
- API inconsistencies or unexpected behavior
- Field types that should exist but don't

**Use the `github-issue-creator` agent** to create a GitHub issue on the `OpenSaasAU/stack` repository:

```
Invoke the github-issue-creator agent with:
- Clear description of the bug or missing feature
- User's use case that triggered the discovery
- Expected vs actual behavior
- Affected files and line numbers
- Your suggested solution (if you have one)
```

This ensures bugs and feature requests are properly tracked and addressed by the OpenSaaS Stack team.

**Example:**

If a user needs geolocation tracking but there's no built-in field type for coordinates:

> "Feature request: Add geolocation field type for storing latitude/longitude coordinates. User needs this for a location-based app. Should support validation, map UI component, and distance queries."

The agent will create a detailed GitHub issue with the use case and proposed implementation.
