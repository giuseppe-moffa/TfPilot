declare module "swr" {
  export type SWRConfiguration = Record<string, unknown>
  export type SWRResponse<Data = any, Error = any> = {
    data?: Data
    error?: Error
    isLoading: boolean
    mutate: (data?: any, shouldRevalidate?: boolean) => Promise<any>
  }

  export default function useSWR<Data = any, Error = any>(
    key: any,
    fetcher?: any,
    config?: SWRConfiguration
  ): SWRResponse<Data, Error>
}
