> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Manage Users

## Create users in env zero

When a new user logs into env zero for the first time, either by starting a trial or accepting an invitation to join an existing Organization, a user profile is created. Profile details are taken from the Google, Github, BitBucket, or Microsoft account that was used to log in. Users are identified by their email address.

<Info>
  **Single Sign-On (SSO)**

  env zero supports Single Sign-On with Azure Active Directory (Microsoft Entra ID) and SAML 2.0 for enterprise authentication. With SSO enabled, users authenticate through your identity provider and are automatically provisioned in env zero.

  You can configure SSO directly from your organization settings. See [Self-Service SSO Integration](/guides/sso-integrations/self-service-sso) for setup instructions.
</Info>

When a user profile is created, a Default Organization is set up for them, and they become its administrator. This Default Organization is used for testing and evaluation. Users can be part of multiple [Organizations](/guides/admin-guide/organizations) and can also accept invitations to join other organizations.

## Manage Organization Users

Organization Administrators have the capability to oversee user management within the organization. This includes assigning users to roles directly or via teams, offering flexibility in how permissions are distributed across the organization, project, and environment.

To access the user management interface, navigate to the Users screen located under the Settings tab. This area is exclusively available to Organization Administrators.

<Info>
  **Note**

  Selecting an Active Project changes the context of the Users screen to project-specific user management, rather than organization-wide settings.
</Info>

Organization Administrators can modify roles, invite new users, or remove existing users from the organization. Direct changes to a user's organization role or their removal from the organization are actions restricted to Organization Administrators only.

## Invite Users to an Organization

Any Organization Administrator can invite other users to join their organization.

Click Invite User, enter a valid email address for the invited user, and then click Send Invitation.

A user can be invited to an organization whether or not they have an active env zero profile. A user is created in env zero for the invitee (if they are not already a user). The invitation email is sent to the user at their email address and the user status is set to Invited.

If the user is new to env zero, a user profile is created when they log in for the first time.

The admin can track the user status in the Users screen, and see when the user has accepted the invitation and joined the organization.

Organization Administrators can revoke an invitation to a user at any time. Click on the garbage can icon next to the user in the Users tab. Once revoked, the user disappears from the list and they can no longer accept the invitation.

## Understanding Roles

env zero uses Role-Based Access Control (RBAC) to manage permissions. Users can be assigned roles at the organization, project, or environment level.

**Organization-level roles** include:

* **[Organization User](/guides/admin-guide/user-role-and-team-management/default-roles#organization-user)** - Basic access to view organization resources
* **[Organization Admin](/guides/admin-guide/user-role-and-team-management/default-roles#organization-admin)** - Full administrative access across the entire organization

For detailed information about all available roles and their permissions, see [Default Roles](/guides/admin-guide/user-role-and-team-management/default-roles). You can also [create custom roles](/guides/admin-guide/user-role-and-team-management/custom-roles) tailored to your organization's needs.

## Project Users

In order to have access to a project, users need to be associated with it.\
Each user associated with a project has a specific project Role assigned to them.

Managing access to a project can be done in 2 ways:

1. **Managing a team's access to a project:**\
   If a user is a member of a team that is assigned to the project, the team's role will cascade onto the user. See the [Teams section](/guides/admin-guide/user-role-and-team-management/teams/#managing-team-access-to-a-project) for more information.

2. **Manage a user's access directly:**\
   A user can also be given a specific role in a project outside of a team. This can be used to give a user additional permissions beyond those assigned by their team, or when the user is not part of any team. Managing users this way requires the Administrator role for that project.\
   Go to Project Settings and then select the Users tab. There you'll see a list of all the organization users. Select users from this list to assign to this project. For each, set a role within the specific project.

If the user has multiple roles that originate from their teams or from their specific role for the project, the highest role will be the one to take effect.

## Project Roles

**Project-level roles** include:

* **[Project Viewer](/guides/admin-guide/user-role-and-team-management/default-roles#project-viewer)** - Read-only access to project resources
* **[Project Planner](/guides/admin-guide/user-role-and-team-management/default-roles#project-planner)** - Can plan deployments but requires approval
* **[Project Deployer](/guides/admin-guide/user-role-and-team-management/default-roles#project-deployer)** - Can deploy and manage environments
* **[Project Admin](/guides/admin-guide/user-role-and-team-management/default-roles#project-admin)** - Full administrative access to the project

Organization Admins automatically have admin access to all projects. For complete details about project roles and their permissions, see [Default Roles](/guides/admin-guide/user-role-and-team-management/default-roles). You can also [create custom roles](/guides/admin-guide/user-role-and-team-management/custom-roles) with specific permissions.

## Environment Access

Users can be assigned roles at the environment level for granular access control. **Environment-level roles** include:

* **[Environment Viewer](/guides/admin-guide/user-role-and-team-management/default-roles#environment-viewer)** - Read-only access to a specific environment
* **[Environment Planner](/guides/admin-guide/user-role-and-team-management/default-roles#environment-planner)** - Can plan changes but requires approval
* **[Environment Deployer](/guides/admin-guide/user-role-and-team-management/default-roles#environment-deployer)** - Can deploy changes to the environment
* **[Environment Admin](/guides/admin-guide/user-role-and-team-management/default-roles#environment-admin)** - Full administrative access to the environment

You can assign different permission levels at different scopes. For example, a user might have Viewer access at the project level but Admin access to a specific environment within that project.

For complete details about environment roles and permissions, see [Default Roles](/guides/admin-guide/user-role-and-team-management/default-roles). To create roles with specific permissions, see [Custom Roles](/guides/admin-guide/user-role-and-team-management/custom-roles).

## Next Steps

Now that you understand user management, continue with team management and access control:

<CardGroup cols={2}>
  <Card title="Manage Teams" icon="users" href="/guides/admin-guide/user-role-and-team-management/teams">
    Learn how to create and manage teams to simplify permission management
  </Card>

  <Card title="Default Roles" icon="shield-check" href="/guides/admin-guide/user-role-and-team-management/default-roles">
    Learn about built-in roles and their permissions at organization, project, and environment levels
  </Card>

  <Card title="Custom Roles" icon="settings" href="/guides/admin-guide/user-role-and-team-management/custom-roles">
    Create and manage custom roles with tailored permissions
  </Card>

  <Card title="Assigning Roles" icon="user-plus" href="/guides/admin-guide/user-role-and-team-management/role-assignment">
    Step-by-step guides for assigning roles to users and teams
  </Card>
</CardGroup>


> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Manage Teams

Teams allow you to manage permissions across your env zero organization more easily by setting a role for an entire group of users as a single entity. Assigning a team's role is now available across all scopes, including organization, project, and environment levels, offering great flexibility and control.

A team belongs to a single [Organization](/guides/admin-guide/organizations). Teams are managed at the Organization Settings level, and are not shared between multiple organizations.

## Creating a Team

In order to create a team, you must be an Organization Admin.

1. Go to **Organization Settings**
2. Click on the **Teams** tab.
3. Click the **Add Team** button
4. Fill in the team's `name` and `description`
5. Click **Confirm** to create the team.

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=c08af0ba0a7cba48c005d9ab622c442f" alt="Interface screenshot showing configuration options" data-og-width="2425" width="2425" data-og-height="1247" height="1247" data-path="images/guides/admin-guide/7789123-image.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?w=280&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=558d2a69507894a27a685e9638bab29c 280w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?w=560&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=4eb517694c82d350af15dbdde861b6f4 560w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?w=840&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=5c1491b76e0360a3569eba66bbf41f43 840w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?w=1100&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=fdecd1c9f748ed1fc1a8167907d18227 1100w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?w=1650&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=2f64a6ad31809c41bbf20ebf01e830b6 1650w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/7789123-image.png?w=2500&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=82259bded9da30c26ae3b55dc120acaa 2500w" />
</Frame>

<img src="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=67455c7d216087f18d97fda4d7fc5780" alt="" data-og-width="637" width="637" data-og-height="438" height="438" data-path="images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?w=280&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=2ae9f6ad80377dc613d1bc0f72e9fe18 280w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?w=560&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=50df90c13dfa5b8bf5bbdc0313f930d8 560w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?w=840&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=8c8c3d53bc95e43f10c039e5c2a6111a 840w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?w=1100&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=af60547b4db3699d200038ecd3c58580 1100w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?w=1650&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=a60b5c8444d435f5c11f26bc96d69a61 1650w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/60e7d13-screen_shot_2020-10-20_at_17.png?w=2500&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=c96d49a00be4e53b8a1dcade2d34778e 2500w" />

## Managing Members

To manage team's members, go to **Organization Settings**, and then to **Teams** tab.

1. Click on the "Users" icon next to the team you would like to change.
2. You will now be redirected to the "Manage Team" page, which lets you edit the team's information, and manage the members of the team.

<Info>
  **Adding Users to a Team**

  Only existing users in the Organization may be added as team members - to add new users to your organization follow the [Users Management guide](/guides/admin-guide/user-role-and-team-management/user-management)
</Info>

<img src="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=e50846833cf2312d4dac498d52293c36" alt="" data-og-width="1463" width="1463" data-og-height="777" height="777" data-path="images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?w=280&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=aa9dbfadf20d77016ed297fe8628d6c4 280w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?w=560&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=68c06ca90b531c7d1fae9de59fcc22c0 560w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?w=840&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=9a0357d98bb25576d31b5933e48967b0 840w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?w=1100&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=c2bfc7e788b0a5642ed510d1f97a9255 1100w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?w=1650&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=25ed447dd200eab2c23747843597b9e7 1650w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/27c92f7-screen_shot_2020-10-20_at_17.png?w=2500&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=c1ed0930c900d19dbb0d7d597f053727 2500w" />

## Managing Team Access to a Project

Either an Organization Admin or a Project Admin can manage the access of members, or teams, of your organization to a project.

This role will cascade into every member of the team. See [Users & Roles](/guides/admin-guide/user-role-and-team-management/user-management/#project-users) for more information on roles.

<Warning>
  Users With Multiple Roles

  In the case a user is assigned to a project with multiple roles (such as being the member of two different teams who each have a different role), then the highest permission role for that project will take precedence.
</Warning>

To modify permissions on a project

1. Go to **Project Settings**, and then to the **Teams** tab.
2. You will see all teams for the organization, assign your desired Teams to the project by clicking the check mark and picking a role for that team from the dropdown.
3. Click on Save when you are done

<img src="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=ebf1ef7a25ce0075c5f81e9b872925af" alt="" data-og-width="1494" width="1494" data-og-height="530" height="530" data-path="images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?w=280&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=a936c26b28132959d6b3e159d391c3a4 280w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?w=560&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=f2936a78c2061e710df7a1e90b04006a 560w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?w=840&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=2d76dfdb54dfce640efc822ee48ae8bd 840w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?w=1100&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=a8086f66794a0230d2495f2ff5e2db72 1100w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?w=1650&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=763530effc5542aa623b08e38037904f 1650w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/e22dc43-screen_shot_2020-10-20_at_17.png?w=2500&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=72ca1369ad47c3b163a326d193decbf0 2500w" />

## Next Steps

Now that you understand team management, learn how to control access with Role-Based Access Control (RBAC):

<CardGroup cols={2}>
  <Card title="Default Roles" icon="shield-check" href="/guides/admin-guide/user-role-and-team-management/default-roles">
    Learn about built-in roles and their permissions at organization, project, and environment levels
  </Card>

  <Card title="Custom Roles" icon="settings" href="/guides/admin-guide/user-role-and-team-management/custom-roles">
    Create and manage custom roles with tailored permissions
  </Card>

  <Card title="Assigning Roles" icon="user-plus" href="/guides/admin-guide/user-role-and-team-management/role-assignment">
    Step-by-step guides for assigning roles to users and teams
  </Card>
</CardGroup>

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Role-Based Access Control (RBAC)

env zero's Role-Based Access Control (RBAC) system allows you to manage permissions for users and teams across your organization, projects, and environments. This comprehensive access control system ensures that team members have the appropriate level of access to perform their responsibilities while maintaining security and governance.

## Understanding Roles in env zero

env zero provides two types of roles to manage access control within your organization:

### Default Roles vs. Custom Roles

**[Default Roles](/guides/admin-guide/user-role-and-team-management/default-roles)** are built-in, non-editable roles that come with every env zero organization. These roles provide standard permission sets for common use cases and cannot be modified or deleted. They are designed to cover the most common access patterns and ensure consistent security practices across organizations.

**[Custom Roles](/guides/admin-guide/user-role-and-team-management/custom-roles)** allow you to create tailored permission sets that match your organization's specific needs. These roles can be created, edited, and deleted as needed, giving you full flexibility to define exactly what permissions users should have.

### Role Assignment Levels and Inheritance

Roles can be assigned at three levels in env zero, and permissions cascade down the hierarchy:

* **Organization Level**: Roles assigned at the organization level apply to the entire organization and cascade down to all projects (including sub-projects) and environments within the organization.
* **Project Level**: Roles assigned at the project level apply to that specific project and cascade down to:
  * All sub-projects within that project
  * All environments within the project and its sub-projects
* **Environment Level**: Roles assigned at the environment level apply only to that specific environment.

<Info>
  **Permission Cascading**

  env zero's RBAC is cascading, top to bottom. If a user or team has a permission at the organization level, they have that permission on every project and environment in the organization. Similarly, project-level permissions apply to all sub-projects and environments within that project.

  However, this does not work in reverse - project permissions only apply to that specific project and its sub-projects, not to the parent project or organization.
</Info>

## RBAC Documentation

<CardGroup cols={2}>
  <Card title="Default Roles" icon="shield-check" href="/guides/admin-guide/user-role-and-team-management/default-roles">
    Learn about built-in roles and their permissions at organization, project, and environment levels
  </Card>

  <Card title="Custom Roles" icon="settings" href="/guides/admin-guide/user-role-and-team-management/custom-roles">
    Create and manage custom roles with tailored permissions
  </Card>

  <Card title="Assigning Roles" icon="user-plus" href="/guides/admin-guide/user-role-and-team-management/role-assignment">
    Step-by-step guides for assigning roles to users and teams
  </Card>
</CardGroup>

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Default Roles

Default roles are built-in, non-editable roles that come with every env zero organization. These roles provide standard permission sets for common use cases and cannot be modified or deleted.

## Organization-Level Default Roles

Organization roles apply across the entire organization and cascade down to all projects (including sub-projects) and environments.

### Organization User

The basic role for organization members. Provides:

* View organization variables, templates, and modules
* View modules from the private module registry
* View providers from the private provider registry

This is the default role assigned when a custom role is deleted from a user at the organization level.

### Organization Admin

Full administrative access to the organization. Includes all available permissions across the platform, including:

* All [Organization User](#organization-user) permissions
* Edit organization settings and variables
* Create and edit templates, modules, and providers
* Create and edit custom roles
* View and edit dashboards
* View audit logs
* Manage billing information
* Move environments between projects
* Manage credentials and VCS connections
* All project and environment permissions

## Project-Level Default Roles

Project roles apply to specific projects and cascade down to:

* All sub-projects within that project
* All environments within the project and its sub-projects

### Project Viewer

Read-only access to project resources. Provides:

* All [Organization User](#organization-user) permissions
* View project settings, templates, variables, and environments
* Read Terraform state files
* View drift causes

### Project Planner

Can create and plan deployments but cannot apply changes. Provides:

* All [Project Viewer](#project-viewer) permissions
* Run plans (create environments, redeploy, destroy - requires approval)

### Project Deployer

Can deploy and manage environments. Provides:

* All [Project Planner](#project-planner) permissions
* Run applies (deploy without requiring approval)
* Edit environment settings
* Write to Terraform state files
* Abort running deployments

### Project Admin

Full administrative access to the project. Provides:

* All [Project Deployer](#project-deployer) permissions
* Edit project settings and variables
* Manage project templates
* Archive environments
* Lock/unlock environments
* Override max TTL settings
* Create cross-project environments
* Force unlock workspaces
* Create new projects
* Assign roles on environments
* Create VCS environments
* Edit VCS environment settings
* Import environments
* Manage credentials and VCS connections

## Environment-Level Default Roles

Environment roles apply to specific environments only.

### Environment Viewer

Read-only access to a specific environment. Provides:

* All [Organization User](#organization-user) permissions
* View environment details, settings, variables, and logs
* Read Terraform state files
* View drift causes

### Environment Planner

Can plan changes to a specific environment. Provides:

* All [Environment Viewer](#environment-viewer) permissions
* Run plans (requires approval)

### Environment Deployer

Can deploy changes to a specific environment. Provides:

* All [Environment Planner](#environment-planner) permissions
* Run applies (deploy without requiring approval)
* Edit environment settings
* Write to Terraform state files
* Abort running deployments

### Environment Admin

Full administrative access to a specific environment. Provides:

* All [Environment Deployer](#environment-deployer) permissions
* Archive the environment
* Lock/unlock the environment
* Override max TTL settings
* Force unlock workspace
* Assign roles on the environment
* Edit allow remote apply settings

## Next Steps

<CardGroup cols={2}>
  <Card title="Manage Users" icon="user" href="/guides/admin-guide/user-role-and-team-management/user-management">
    Learn how to invite and manage users in your organization
  </Card>

  <Card title="Manage Teams" icon="users" href="/guides/admin-guide/user-role-and-team-management/teams">
    Learn how to create and manage teams to simplify permission management
  </Card>

  <Card title="Custom Roles" icon="settings" href="/guides/admin-guide/user-role-and-team-management/custom-roles">
    Create and manage custom roles with tailored permissions
  </Card>

  <Card title="Assigning Roles" icon="user-plus" href="/guides/admin-guide/user-role-and-team-management/role-assignment">
    Step-by-step guides for assigning these roles to users and teams
  </Card>
</CardGroup>

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Assigning Roles

Roles can be assigned at three levels: organization, project, and environment.

## Assigning Organization Roles

Organization roles can be assigned to both individual users and teams, and apply across the entire organization (including all projects and environments).

### Assigning Organization Roles to Users

<Steps>
  <Step title="Navigate to Organization Settings">
    Go to **Organization Settings** > **Users** tab.
  </Step>

  <Step title="Select User Role">
    Locate the user in the table and click the **Role** dropdown for that user.
  </Step>

  <Step title="Choose Role">
    Select from the available roles in the dropdown:

    * Default roles: [Organization User](/guides/admin-guide/user-role-and-team-management/default-roles#organization-user), [Organization Admin](/guides/admin-guide/user-role-and-team-management/default-roles#organization-admin)
    * Custom roles: Any custom roles created for your organization

    <Info>
      **Role Dropdown Organization**: Default roles are listed first, followed by a separator, then custom roles in alphabetical order.
    </Info>
  </Step>

  <Step title="Save Changes">
    Click **SAVE** to apply the changes.
  </Step>
</Steps>

<img src="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=41a5e370ce84125bae9cefe83e52ea7f" alt="Organization User Role Assignment" data-og-width="1721" width="1721" data-og-height="877" height="877" data-path="images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?w=280&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=2585a1d0f6cffe663350c1ab7152b4e2 280w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?w=560&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=a316a21ee39ad48a517062e89f9dd0ed 560w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?w=840&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=17b231043bc23e744210345038369e8c 840w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?w=1100&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=217044684fa7adabb31cf5d44d848f54 1100w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?w=1650&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=d3e36f5efe2292493a0c93f3e0086a6e 1650w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-user-role-assignment.png?w=2500&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=f3c0ee7e9ab6fa42e574170d7643d991 2500w" />

### Assigning Organization Roles to Teams

<Steps>
  <Step title="Navigate to Organization Settings">
    Go to **Organization Settings** > **Teams** tab.
  </Step>

  <Step title="Select Team Role">
    Locate the team in the table and click the **Role** dropdown for that team.
  </Step>

  <Step title="Choose Role">
    Select from the available roles:

    * Default roles: [Organization User](/guides/admin-guide/user-role-and-team-management/default-roles#organization-user), [Organization Admin](/guides/admin-guide/user-role-and-team-management/default-roles#organization-admin)
    * Custom roles: Any custom roles created for your organization
  </Step>

  <Step title="Save Changes">
    Click **SAVE** to apply the changes.
  </Step>
</Steps>

<img src="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=5cdf07db3bb6d5f2c152d21faa139c2c" alt="Organization Team Role Assignment" data-og-width="1719" width="1719" data-og-height="697" height="697" data-path="images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?w=280&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=04a0a10d1c0695d6eb1f7222d67d6b82 280w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?w=560&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=a807a804397627e82a7c4cdb95896aba 560w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?w=840&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=735b562f5234c271c926705457ec028a 840w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?w=1100&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=10a314cd25ca665598890e95be17b8f2 1100w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?w=1650&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=0f3c0b2c999d2933e675468b367d8595 1650w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/org-team-role-assignment.png?w=2500&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=4400a898b5574e86d3388ad3f7e57358 2500w" />

## Assigning Project Roles

Project roles can be assigned to both users and teams and apply to a specific project, all its sub-projects, and all environments within them.

### Assigning Project Roles to Users

<Steps>
  <Step title="Navigate to Project Settings">
    Go to **Project Settings** > **Users** tab.
  </Step>

  <Step title="Select User">
    Locate the user in the table and check the checkbox in the **Assign** column.
  </Step>

  <Step title="Choose Role">
    Click the **Role** dropdown that appears and select from the available roles:

    * Default roles: [Project Viewer](/guides/admin-guide/user-role-and-team-management/default-roles#project-viewer), [Project Planner](/guides/admin-guide/user-role-and-team-management/default-roles#project-planner), [Project Deployer](/guides/admin-guide/user-role-and-team-management/default-roles#project-deployer), [Project Admin](/guides/admin-guide/user-role-and-team-management/default-roles#project-admin)
    * Custom roles: Any custom roles created for your organization
  </Step>

  <Step title="Save Changes">
    Click **SAVE** to apply the changes.
  </Step>
</Steps>

<img src="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=bbe906f67c685f1f6384928e7a8e449f" alt="Project User Role Assignment" data-og-width="1730" width="1730" data-og-height="719" height="719" data-path="images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?w=280&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=1ec8c1e9c91c4ec60adde4359d9059f6 280w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?w=560&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=17f31e3523c7e80d4758c54e68c95691 560w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?w=840&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=939c47a3d95c19a328837cd2dbc50028 840w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?w=1100&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=e85053c689ed112f525975e6a614841b 1100w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?w=1650&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=f33a675710660b1d092bbf9d5cd43e29 1650w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-user-role-assignment.png?w=2500&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=3f0ce59a3490a2ca4b28ba0cffb9f465 2500w" />

<Info>
  **Important:** You must first select the user using the checkbox in the **Assign** column before you can choose their role.
</Info>

### Assigning Project Roles to Teams

<Steps>
  <Step title="Navigate to Project Settings">
    Go to **Project Settings** > **Teams** tab.
  </Step>

  <Step title="Select Team">
    Locate the team in the table and check the checkbox in the **Assign** column.
  </Step>

  <Step title="Choose Role">
    Click the **Role** dropdown that appears and select from the available roles:

    * Default roles: [Project Viewer](/guides/admin-guide/user-role-and-team-management/default-roles#project-viewer), [Project Planner](/guides/admin-guide/user-role-and-team-management/default-roles#project-planner), [Project Deployer](/guides/admin-guide/user-role-and-team-management/default-roles#project-deployer), [Project Admin](/guides/admin-guide/user-role-and-team-management/default-roles#project-admin)
    * Custom roles: Any custom roles created for your organization
  </Step>

  <Step title="Save Changes">
    Click **SAVE** to apply the changes.
  </Step>
</Steps>

<img src="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=ec02ca89493ea887caca7fc9a38a94e9" alt="Project Team Role Assignment" data-og-width="1718" width="1718" data-og-height="758" height="758" data-path="images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?w=280&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=119adcbafc4db748e0e5656d988cc1c4 280w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?w=560&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=a80c5488e1545a5972b4530ac8f24ff8 560w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?w=840&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=da2198105fb73352bfd2f9c7945a7213 840w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?w=1100&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=9f74e1863de56636f9351958bd32d5e9 1100w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?w=1650&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=8c14c8cd5fc0c9bfdc1e38b2f4c68346 1650w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/project-team-role-assignment.png?w=2500&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=5ad4338102830e8af757e6d45b21be80 2500w" />

<Info>
  **Important:** You must first select the team using the checkbox in the **Assign** column before you can choose their role.
</Info>

## Assigning Environment Roles

Environment roles can be assigned to both users and teams and apply only to a specific environment.

<Note>
  **Team Role Assignment Limitation**

  Default roles cannot be assigned to teams at the environment level. Teams can only be assigned custom roles at the environment level.
</Note>

### Assigning Environment Roles to Users

<Steps>
  <Step title="Navigate to Environment">
    Go to the **Environment** page and click the **ACCESS** tab.
  </Step>

  <Step title="Select User">
    In the **Manage Users** card, locate the user in the table and check the checkbox in the **Assign** column.
  </Step>

  <Step title="Choose Role">
    Click the **Role** dropdown that appears and select from the available roles:

    * Default roles: [Environment Viewer](/guides/admin-guide/user-role-and-team-management/default-roles#environment-viewer), [Environment Planner](/guides/admin-guide/user-role-and-team-management/default-roles#environment-planner), [Environment Deployer](/guides/admin-guide/user-role-and-team-management/default-roles#environment-deployer), [Environment Admin](/guides/admin-guide/user-role-and-team-management/default-roles#environment-admin)
    * Custom roles: Any custom roles created for your organization
  </Step>

  <Step title="Save Changes">
    Click **SAVE** to apply the changes.
  </Step>
</Steps>

<img src="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=5b1e0419a9a1f5dc59cb25c69dfd042f" alt="Environment User Role Assignment" data-og-width="1741" width="1741" data-og-height="903" height="903" data-path="images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?w=280&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=10bb437e442822321216bef75727bead 280w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?w=560&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=039cd6b2c553a02d15a8d24e38bf0aa0 560w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?w=840&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=459199119c66af763c2444d5c9d32324 840w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?w=1100&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=cf66315156bd958dc48b6adbbd2bd469 1100w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?w=1650&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=2c944aa8de1815fde64044cda3594a1c 1650w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-user-role-assignment.png?w=2500&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=1b1c37298e3d672b0ea03a05692fe2ac 2500w" />

<Info>
  **Important:** You must first select the user using the checkbox in the **Assign** column before you can choose their role.
</Info>

### Assigning Environment Roles to Teams

<Steps>
  <Step title="Navigate to Environment">
    Go to the **Environment** page and click the **ACCESS** tab.
  </Step>

  <Step title="Select Team">
    In the **Manage Teams** card, locate the team in the table and check the checkbox in the **Assign** column.
  </Step>

  <Step title="Choose Role">
    Click the **Role** dropdown that appears and select a custom role.
  </Step>

  <Step title="Save Changes">
    Click **SAVE** to apply the changes.
  </Step>
</Steps>

<img src="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=f22e61c29027979427f8732a1f5de458" alt="Environment Team Role Assignment" data-og-width="1733" width="1733" data-og-height="1034" height="1034" data-path="images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?w=280&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=f9027158eddb641062af3f4e458560eb 280w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?w=560&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=cc107c7ac58b2fecb8e21a1e83a3fad5 560w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?w=840&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=7de17545ce70e4bb7b8985204b14bc39 840w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?w=1100&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=4940976c7eb06abdff5199abbc5decb6 1100w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?w=1650&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=67fc87bf1b713f1f161f9b8ae4a31bd6 1650w, https://mintcdn.com/envzero-b61043c8/ngeLWWxxE3C57X-b/images/guides/admin-guide/user-role-and-team-management/environment-team-role-assignment.png?w=2500&fit=max&auto=format&n=ngeLWWxxE3C57X-b&q=85&s=445ab657c9d7d5b2e28b0c214f62c5fd 2500w" />

<Note>
  **Default Role Limitation**

  Default roles ([Environment Viewer](/guides/admin-guide/user-role-and-team-management/default-roles#environment-viewer), [Environment Planner](/guides/admin-guide/user-role-and-team-management/default-roles#environment-planner), [Environment Deployer](/guides/admin-guide/user-role-and-team-management/default-roles#environment-deployer), [Environment Admin](/guides/admin-guide/user-role-and-team-management/default-roles#environment-admin)) cannot be assigned to teams at the environment level. Only custom roles are available for team assignments.
</Note>

<Info>
  **Important:** You must first select the team using the checkbox in the **Assign** column before you can choose their role.
</Info>

## Next Steps

<CardGroup cols={2}>
  <Card title="Manage Users" icon="user" href="/guides/admin-guide/user-role-and-team-management/user-management">
    Learn how to invite and manage users in your organization
  </Card>

  <Card title="Manage Teams" icon="users" href="/guides/admin-guide/user-role-and-team-management/teams">
    Learn how to create and manage teams to simplify permission management
  </Card>

  <Card title="Default Roles" icon="shield-check" href="/guides/admin-guide/user-role-and-team-management/default-roles">
    Review the built-in default roles and their permissions
  </Card>

  <Card title="Custom Roles" icon="settings" href="/guides/admin-guide/user-role-and-team-management/custom-roles">
    Create custom roles before assigning them
  </Card>
</CardGroup>

