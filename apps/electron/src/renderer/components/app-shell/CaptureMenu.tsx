import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, FolderOpen, ExternalLink } from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getFileManagerName } from '@/lib/platform'

export interface CaptureMenuProps {
  itemId: string
  itemUrl?: string
  onOpenUrl?: () => void
  onShowInFinder?: () => void
  onDelete: () => void
  canShowInFinder: boolean
}

export function CaptureMenu({
  itemUrl,
  onOpenUrl,
  onShowInFinder,
  onDelete,
  canShowInFinder,
}: CaptureMenuProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {itemUrl && onOpenUrl && (
        <MenuItem onClick={onOpenUrl}>
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="flex-1">{t('captureMenu.openUrl')}</span>
        </MenuItem>
      )}

      {canShowInFinder && onShowInFinder && (
        <MenuItem onClick={onShowInFinder}>
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}</span>
        </MenuItem>
      )}

      <Separator />

      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t('captureMenu.delete')}</span>
      </MenuItem>
    </>
  )
}
