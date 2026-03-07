> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Manage Organizations

## What is an organization?

An *Organization* is the highest level logical entity in env zero.

All *Projects*,  *Templates*,  *Variable*,  *Policies*, and *Environments*, are defined for a specific organization.  Organizations are logically separate from each other, and do not share any entities.

Most users belong to a single organization, but they can be a member of several organizations, with different roles and permissions for each one.

An organization is the highest level scope for settings such as [Variables and Secrets](/guides/admin-guide/variables), and [Policies](/guides/policies-governance/policies).

Only users with *administrator* role in an organization, can change the settings or invite new users for that organization.

## Select the active organization

Users in env zero have one *Active Organization*. This is shown at the upper left of the screen.

To change the Active Organization, click the organization name, and then select an organization from the list.

## Join an organization

A user can join an organization in the following ways:

* When joining env zero the user is added to the env zero Demo Organization.
* By invitation, from an organization administrator.
* By creating a new organization, in which case the user becomes the first user and administrator for the new organization.
* Through Single Sign-On (SSO), if configured for the organization. Users authenticating via SSO are automatically provisioned with appropriate roles.

## Create an Organization

To create a new organization, click *Active Organization* at the upper right, and then click *Create Organization*.

Enter a name, description (optional), and URL for the organization logo (optional).\
You can edit these settings later.

Once the organization is created,  it automatically becomes the *Active Organization*.  You can add a user to the organization, in the *Setting* tab.

## Organization Settings

*Organization* is the highest scope for configuration in env zero.  All other entities inherit the organization's settings.

Only a user with the *administrator* role can view or edit the organization settings.

To edit the settings, select the *Settings* tab at the upper left.

Organization settings include name and logo, user management, SSO configuration, API Key management, and policies.

*Variables* configuration is accessed in the *Variables* tab and is accessible to non-administrator users as well.

## Finding my Organization ID

Sometimes you may need your organization id for various reasons. Here's how you can find it:

1. Click on your organization icon in the bottom left corner
2. Select `Settings` from the left side panel
3. Go to the `General` tab under `Organization Settings`
4. Copy the Organization `ID` as shown in the screenshot below

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=0b1f3b4a28aa6150f7643fc9f854c16d" alt="Interface screenshot showing configuration options" data-og-width="2284" width="2284" data-og-height="1566" height="1566" data-path="images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?w=280&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=ae47e6b5958aed2cbf6e83fd7318f8a7 280w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?w=560&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=a6e91e3e94db388d3e7a9f8a3342a24c 560w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?w=840&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=9e907969e110036a6621ed7dfe5ac9f4 840w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?w=1100&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=5b48126f4c6d6c146d05b634dfc1d0cb 1100w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?w=1650&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=c2108a7acaf6859c46506098673cacb6 1650w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/c982227f0a1d55883c693dc85deea22d71e79e638bbff4193535b10ecaade6e0-cleanshot_2024-09-29_at_5.png?w=2500&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=08c4205aee346e6e492eaa8dcc20396d 2500w" />
</Frame>

## Single Sign-On (SSO)

Organizations can configure Single Sign-On to authenticate users through an external identity provider. This enables centralized user management, enforces your security policies, and meets enterprise compliance requirements.

SSO can be configured directly from Organization Settings > SSO tab. See [Self-Service SSO Integration](/guides/sso-integrations/self-service-sso) for setup instructions.

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Manage Projects

Projects are used in env zero to provide granular access control to *Environments*. Every environment in env zero exists under a project, and users are given access on a per-project basis.

Projects are also useful for managing multiple cloud accounts within a single *Organization*.

Projects are created in an [Organization](/guides/admin-guide/organizations). To start, every new *Organization* has a *Default Organization Project*, which is created with the *Organization*. Additional projects can be added as needed.

We recommend using projects to separate dev environments from production environments, each with its own access rights and policies.

## Active Projects

Users usually work in the context of an *Active Project*,  but they can also work in the context of an *Organization*.

The current *Active Project* is shown in the upper left corner of the page, in the *organization/project* select box. If only an *Organization* name appears, no project is currently selected.

In a *Project* context,  the *Templates* tab shows only templates associated with this project, and the *Settings* tab (available only to project admins) shows the users associated with this project.\
Environments are only accessible in a *Project* context.

If no project is selected,  a *Projects* tab will appear, instead of the *Environments* tab.  This tab shows a list of all projects associated with the current user.  Select a project to set it as the *Active* project.

To switch to the *Organization* view,  select the organization in the *organization/project* select box.

## Create a New Project

To create a new project,  you must to be in an *Organization* context, with no *Active Project* selected.\
Select the *Projects* tab,  and then click *Create New Project*. Enter a project name and description.

A new project will be created and set as the *Active Project*.

You can then associate users with the project, in the settings.

## Associate Templates with a Project

Only templates that are associated with the current project can be used to create environments.

A newly created project has no templates associated with it, to manage the project templates, select an  *Active Project*, then:

* Select the *Templates* tab, and then click *Manage Templates*
* This shows a list of all available templates in the current *Organization*, from which you can select one to associate with the current project.
* Click *Save* to save the new associations.

## Manage User Access Control to a Project

For details on how to manage user access control in a specific project, see [Users & Roles](/guides/admin-guide/user-role-and-team-management/user-management/#project-users).

## Finding The Project ID

Sometimes you may need your project id for using it in our [terraform provider](https://registry.terraform.io/providers/env0/env0/latest) or for some [API calls](/api-reference/getting-started/authentication).

You can find it under the `General` tab in `Project Settings`

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=9861f1931f97ec9fc2fa4fff83e2946a" alt="Interface screenshot showing configuration options" data-og-width="2778" width="2778" data-og-height="1386" height="1386" data-path="images/guides/admin-guide/4cf84ec-project_settings.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?w=280&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=3deb73f8c9c2d8b8f834fa5ba60873f3 280w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?w=560&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=c5becba81fdc54ec9cbbf9e44bee5ce6 560w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?w=840&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=46eb467004abcf9374d7a633f2feac98 840w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?w=1100&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=36a319a432aa05ed8f40b2c2d0242ca6 1100w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?w=1650&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=79a3b9e05c26d7641acf218231bd8db3 1650w, https://mintcdn.com/envzero-b61043c8/pcx_nh6zT3at7dYL/images/guides/admin-guide/4cf84ec-project_settings.png?w=2500&fit=max&auto=format&n=pcx_nh6zT3at7dYL&q=85&s=e64fac1d0cc54a8cb1ce44cd65b6a93b 2500w" />
</Frame>

## Archive Project

Archiving a project is a way to make it inactive without permanently deleting it. This can be useful for projects that are no longer in active development but may need to be referenced or reactivated later.

When you archive a project, the following changes will take effect:

* **Running Environments:** Any active environments within the project will not be destroyed. However, they will be marked as inactive and will not be accessible for deployment or management.
* **Deployments:** Continuous and scheduled deployments will no longer run for the archived project.
* **Project Visibility:** The project will be hidden from the main list of projects in your organization's dashboard.
* **Budget Notifications:** You will no longer receive notifications for any configured budget thresholds, even if they are exceeded.
  This allows you to keep your project list clean and focused on active work, while still preserving the configuration and history of older projects.

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.envzero.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Manage Sub-Projects

As your organization's IaC use grows, you might find that a single hierarchy level *Project* level is insufficient to organize all resources and domains. *Sub Projects* help you better organize your *Projects*, *Environments*, and configurations within your organization.

Sub Projects have similar configurations to *Projects* but are nested within other *Projects*. Each *Sub Project* may have its own *Environments*, *Templates*, *Variables*, etc. Users may be assigned different Roles for different *Projects* in a given hierarchy, e.g. only view a parent *Project*, but run plans under a *Sub Project*.

## Navigating to a Sub Project

### Projects Page

The *Organization's Projects Page* shows *Projects* that don't have a parent. Clicking on the \_ Project\_ will make it the [Active Project](/guides/admin-guide/projects/#active-projects) and will bring it to its own *Sub Projects* page if there are any, or to its *Environments* page. When clicking on another *Sub Project* the same rules apply - if there are more *Sub Projects* you'll be able to navigate into them and when there are no more *Sub Projects* the *environments* are shown

### Projects Menu

The menu shows only *Projects* without a *Parent Project*. Projects containing *Sub Projects* will have an arrow next to them. Hovering on the project will show you its *Sub Projects*. That way you can use the projects menu to access any project in your organization

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=07de1b86840d7dbf4da2f9d6754262a4" alt="Interface screenshot showing configuration options" data-og-width="484" width="484" data-og-height="738" height="738" data-path="images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?w=280&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=a0e812ceaada1282b4198b6cd0a8629b 280w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?w=560&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=ff4d0d7a90f61ff6b384318e91582a05 560w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?w=840&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=e565d84ddeff048141621eb88c1a972e 840w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?w=1100&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=036327ad70508573a7402806e1086ee3 1100w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?w=1650&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=25b8f6541f72a65afa0159cadffa130c 1650w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/78db681-project_and_sub_projects_1.png?w=2500&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=e752ada4e058ef565134e2e50b96aac0 2500w" />
</Frame>

When choosing a *Project*, you may navigate to its *Sub Projects* page from the menu.

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=4ff1f615cb61ee2b0d3f17545a63ab95" alt="Interface screenshot showing configuration options" data-og-width="484" width="484" data-og-height="636" height="636" data-path="images/guides/admin-guide/projects/1f8ed58-sub_project.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?w=280&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=5a4698ccd8340253acc175fad9d02e99 280w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?w=560&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=2c845211d25d758fc85c4c66ea777f71 560w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?w=840&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=910b2fb5f1dacb5176637ae6803adb6b 840w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?w=1100&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=78f514aa05e11a837b7c5a93a74c278d 1100w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?w=1650&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=b06a8e74f47fafd15ece66f7a7104824 1650w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/1f8ed58-sub_project.png?w=2500&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=1a5a6f4c6860cfb5d5ae1e68604f899d 2500w" />
</Frame>

## Creating a Sub Project

To create a subproject, hover over the desired project in the left navigation panel and press the plus icon.

<img src="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=73e4689aec40d347696a22ac9c0cc05a" alt="" data-og-width="536" width="536" data-og-height="320" height="320" data-path="images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?w=280&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=62c4e543879029ee7f0725e92bb9c67d 280w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?w=560&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=680030178b943197b76590a211a80857 560w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?w=840&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=0ee918eeffc87e4d789ffce662439177 840w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?w=1100&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=a580395b4b8a52a122b3ded930ce1691 1100w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?w=1650&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=01de55fd9e8767839a53ab7d15b105ff 1650w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e2f2e50e915273f55b6fe35a556537fb8f21e686260678e791471b14994c5261-image.png?w=2500&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=1a2da1f45be276ab2a04e34717bca5ff 2500w" />

## RBAC for Sub Projects

Each *Sub Project* inherits the *Roles* from its parent *Project* up to the root *Project*.

If a user doesn't have the *"View Project"* permission to view for a parent *Project*, but does have it on the *Sub Project*, the user may navigate the project using the menu items, with hovering over the ancestor *Projects* until the relevant project appears in the menu. Users are not allowed to click and navigate to any project they lack the *"View Project"* permission for.

<Note>
  **Associated Credentials and Templates, Policies, and configured Notifications only affect the Project in which they are configured, and not affecting any Sub Project under said Project. As for Costs, each Project takes into account its own Environments only, without any Environment in its Sub Projects.**
</Note>

<Info>
  **Unlike the above, [Variables](/guides/admin-guide/variables) are inherited from Parent Projects to Sub Projects.**
</Info>

## Environment migration from (sub) project to (sub) project

When using env zero local backend, migrating from 1 (sub) project to another (sub) project is not supported.

When using env zero remote backend, migrating from 1 (sub) project to another (sub) project requires the following procedure to be followed:

1. On a local machine:

* Log into env zero backend "terraform login backend.api.env0.com"
* Add the env zero remote backend code to the resource:

```yaml  theme={null}
terraform {
  backend "remote" {
    hostname = "backend.api.env0.com"
    organization = "[Org ID].[Project ID]"

    workspaces {
      name = "[Workspace Name]"
    }
  }
}
```

* Ensuring there are no ".terraform" files or folders in the directory
* Run "terraform init"
* Run "terraform plan" to ensure no changes are seen in the correct environment
* Run "terraform state pull > state2migrate.tfstate"
* Confirm the state2migrate.tfstate file has been populated.
* Update the project ID and workspace name in the code above.  If a SubProject is being used, replace the Project ID with the SubProject ID (i.e. \[Org ID].\[SubProject ID]
* Remove the ".terraform" files and folders.

2. In env zero:

* Navigate to the new (sub) project location
* Create a new environment running from the same VCS code with the same terraform and environmental variables.\
  \*\* Ensure auto-approval is turned off.\
  \*\* Enable "Use env0 Remote Backend"
* Cancel the deployment at the "approve plan" stage as to not recreate the resources.

3. On the local machine:

* Run "terraform init"
* Run "terraform state push state2migrate.tfstate"
* Run "terraform plan" to ensure no changes are seen in the correct environment

4. In env zero:

* Redeploy the new environment and approve as no changes should be seen.
* Make the old environment inactive.
* (Optional) All local ".terraform" files and the remote backend configuration can be removed from the local machine.

## Moving Sub-Projects

Going into the project you want to move in the Project Settings of the page you can find a **Move** button

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=7ddd8a40b043498c55f943bbf5b7497b" alt="Interface screenshot showing configuration options" data-og-width="2780" width="2780" data-og-height="1284" height="1284" data-path="images/guides/admin-guide/projects/7c09364-move_a_sub_project.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?w=280&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=52452b16534ca3e97fa632f7ef9bd54e 280w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?w=560&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=879592aff5b0f2a108fc310b909d8aee 560w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?w=840&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=7b59ecc76a76ad6e06c7e4c93c34aa8d 840w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?w=1100&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=49fe77ced6d338e38bc8fbe293cd66f2 1100w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?w=1650&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=316542bac5bdf1c412fa74d02884abf8 1650w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/7c09364-move_a_sub_project.png?w=2500&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=ace08cefb8d7c7102ad94749122f11fb 2500w" />
</Frame>

Using that button will open a popup allowing you to select which project you want that project to move into

<Frame>
  <img src="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=920b3343a3576a11f6a82ba3241c88c0" alt="Interface screenshot showing configuration options" data-og-width="1438" width="1438" data-og-height="1120" height="1120" data-path="images/guides/admin-guide/projects/e1e36be-image.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?w=280&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=c796dde219209a5db04966a81bd3748d 280w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?w=560&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=f923164c7a7ef89a9330797c4e6831d1 560w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?w=840&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=166fb7d535bfb79352cbfaace1dcd8fc 840w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?w=1100&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=34d5e6d2a6e3efa13362e9600ad31614 1100w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?w=1650&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=4fe4539c29c1883281e0a84fc271dbfa 1650w, https://mintcdn.com/envzero-b61043c8/pvGFjFxaiqGDTFG3/images/guides/admin-guide/projects/e1e36be-image.png?w=2500&fit=max&auto=format&n=pvGFjFxaiqGDTFG3&q=85&s=3d381f208fbafd86d5f5392749fa0db2 2500w" />
</Frame>

After pressing the Move button on the project selection popup the project (and its subprojects if he has any) will be moved to the selected target project

## Suggested Blog Content

[Terraform Modules Guide](https://www.env0.com/blog/terraform-modules)

[Terraform Plan Examples](https://www.env0.com/blog/terraform-plan)

[Managing Terraform Variable Hierarchy](https://www.env0.com/blog/managing-terraform-variable-hierarchy)

[ Manage Terraform Remote State with a Remote Backend](https://www.env0.com/blog/terraform-remote-state-using-a-remote-backend)
