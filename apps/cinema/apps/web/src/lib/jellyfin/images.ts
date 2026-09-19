import type { Api } from '@jellyfin/sdk'
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import type { ImageRequestParameters } from '@jellyfin/sdk/lib/models/api/image-request-parameters'

/**
 * Image URLs are plain GETs -- no auth header needed, so they go straight into
 * `src`. The SDK appends the correct `tag`, which is what makes these
 * cacheable forever and invalidated when artwork changes.
 */
export function itemImageUrl(
  api: Api,
  item: BaseItemDto | undefined,
  type: ImageType = ImageType.Primary,
  params: ImageRequestParameters = {},
): string | undefined {
  if (!item) return undefined
  // getItemImageUrl builds a URL whether or not the item HAS that image, so a
  // film with no logo used to render a broken <img> with its alt text showing.
  // The tag maps are the server's own answer to "does this artwork exist".
  const exists =
    type === ImageType.Backdrop
      ? Boolean(item.BackdropImageTags?.length) || Boolean(item.ImageTags?.[type])
      : Boolean(item.ImageTags?.[type])
  if (!exists) return undefined
  return getImageApi(api).getItemImageUrl(item, type, { quality: 90, ...params })
}

export function itemBackdropUrl(
  api: Api,
  item: BaseItemDto | undefined,
  params: ImageRequestParameters = {},
): string | undefined {
  if (!item) return undefined
  const backdrops = getImageApi(api).getItemBackdropImageUrls(item, {
    quality: 90,
    maxWidth: 1920,
    ...params,
  })
  // Fall back to the item's own Backdrop, then to a parent's (episodes
  // usually carry no backdrop of their own).
  return (
    backdrops[0] ??
    itemImageUrl(api, item, ImageType.Backdrop, params) ??
    itemImageUrl(api, item, ImageType.Thumb, params)
  )
}

export { ImageType }

/**
 * A user's avatar. Sessions carry the id and the tag but not a `UserDto`, so
 * the two fields the URL builder actually reads are passed as one.
 */
export function userImageUrl(
  api: Api,
  userId: string | null | undefined,
  tag: string | null | undefined,
  params: ImageRequestParameters = {},
): string | undefined {
  if (!userId || !tag) return undefined
  return getImageApi(api).getUserImageUrl(
    { Id: userId, PrimaryImageTag: tag },
    { quality: 90, fillWidth: 64, fillHeight: 64, ...params },
  )
}
