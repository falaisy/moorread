import type { StateCreator } from 'zustand'
import type { BookmarkSlice, NavState } from './store-types'

import { createBookmarkCrudActions } from './store-bookmark-crud-actions'
import { createBookmarkDescriptionActions } from './store-bookmark-description-actions'
import { createBookmarkMetadataActions } from './store-bookmark-metadata-actions'
import { createBookmarkOrderActions } from './store-bookmark-order-actions'
import { createBookmarkUsageActions } from './store-bookmark-usage-actions'

export const createBookmarkSlice: StateCreator<
  NavState,
  [],
  [],
  BookmarkSlice
> = (set, get) => ({
  categories: [],
  bookmarks: [],
  meta: {},
  categoryMeta: {},
  usage: {},

  activeCategoryId: 'all',
  categorySelectionTouched: false,
  bookmarkSearchQuery: '',

  ...createBookmarkMetadataActions(set, get),
  ...createBookmarkDescriptionActions(set, get),
  ...createBookmarkCrudActions(set, get),
  ...createBookmarkOrderActions(set, get),
  ...createBookmarkUsageActions(set, get),
})
