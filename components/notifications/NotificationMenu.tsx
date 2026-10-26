'use client';

import { useId, useState } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { ArrowForward, ContentCopy, MoreVert, OpenInFull } from '@mui/icons-material';
import toast from 'react-hot-toast';

/**
 * A notice in a list: two lines at most, cut with an ellipsis by CSS - the
 * text itself is never shortened, so the full message is still there to open
 * and copy. `overflowWrap: anywhere` breaks a long URL or an unbroken word
 * rather than letting it push the card wider than the screen.
 */
export const MESSAGE_PREVIEW_SX = {
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  overflow: 'hidden', overflowWrap: 'anywhere',
} as const;

/** A notice opened: all of it, with its own line breaks. */
export const MESSAGE_FULL_SX = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;

/**
 * Copies text, also where the Clipboard API is unavailable - it needs a
 * secure context, and a barangay hall may open the app over plain http on
 * the local network.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the older route */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand('copy');
    ta.remove();
    return done;
  } catch {
    return false;
  }
}

/**
 * The actions on one notice: read it whole, copy it, open its case.
 *
 * A sibling of the row's own button, never inside it - a button inside a
 * button is invalid, and a click here must not also open the notice. "View
 * case" is offered only when the caller passes a way to open one, which it
 * does only for a case this user can open.
 */
export default function NotificationMenu({ title, message, onViewMessage, onViewCase }: {
  title: string;
  /** The complete message, as stored - what is copied. */
  message: string;
  onViewMessage: () => void;
  onViewCase?: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const open = Boolean(anchor);
  const close = () => setAnchor(null);

  const copy = async () => {
    close();
    if (await copyText(message)) toast.success('Message copied');
    else toast.error('Could not copy - open the message and select the text instead');
  };

  return (
    <>
      <Tooltip title="More actions">
        <IconButton
          size="small"
          aria-label={`More actions for notification: ${title}`}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          aria-expanded={open ? 'true' : undefined}
          onClick={e => { e.stopPropagation(); setAnchor(e.currentTarget); }}
          sx={{
            width: 36, height: 36, color: '#94a3b8', flexShrink: 0,
            '&:hover': { color: '#0c1e46', bgcolor: '#f1f5f9' },
            '&.Mui-focusVisible': { outline: '3px solid #14b8a655', outlineOffset: 1 },
          }}
        >
          <MoreVert sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      {/* MUI's menu closes on Escape, on a click outside and on a choice,
          returns focus to this button, and moves through items by arrow key. */}
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={close}
        onClick={e => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200, borderRadius: 2 } } }}
      >
        <MenuItem onClick={() => { close(); onViewMessage(); }} sx={{ minHeight: 44 }}>
          <ListItemIcon><OpenInFull fontSize="small" /></ListItemIcon>
          <ListItemText>View full message</ListItemText>
        </MenuItem>
        <MenuItem onClick={copy} sx={{ minHeight: 44 }}>
          <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
          <ListItemText>Copy message</ListItemText>
        </MenuItem>
        {onViewCase && (
          <MenuItem onClick={() => { close(); onViewCase(); }} sx={{ minHeight: 44 }}>
            <ListItemIcon><ArrowForward fontSize="small" /></ListItemIcon>
            <ListItemText>View case</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
