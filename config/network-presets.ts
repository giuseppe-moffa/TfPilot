/**
 * Network presets (env0-style): predefined VPC + subnet + security group sets.
 * Used by EC2 and other modules to avoid requiring raw subnet_id/security_group_ids in the main flow.
 */

export type NetworkPreset = {
  id: string
  label: string
  vpcId: string
  publicSubnetIds: string[]
  defaultSecurityGroupId: string
}

export const networkPresets: NetworkPreset[] = [
  {
    id: "shared-public",
    label: "Shared Public VPC",
    vpcId: "vpc-00a3272d06e0ae01c",
    publicSubnetIds: [
      "subnet-09169af2390c33dd9",
      "subnet-08ba0c093135facc0",
      "subnet-09df87c077abc295e",
    ],
    defaultSecurityGroupId: "sg-00c2997a8b5f86149",
  },
]

export const networkPresetIds = networkPresets.map((p) => p.id)

export function getNetworkPreset(id: string): NetworkPreset | undefined {
  return networkPresets.find((p) => p.id === id)
}
