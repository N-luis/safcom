'use client';

import { useState } from 'react';
import { Box, Card, CardContent, Typography, Skeleton, Modal, Fade, Backdrop, IconButton } from '@mui/material';
import { TrendingUp, TrendingDown, Close } from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useCountUp } from '@/hooks/useCountUp';

interface StatCardProps {
  title: string;
  value: number;
  change: number;
  changeLabel: string;
  icon: React.ElementType;
  gradient: string;
  loading?: boolean;
  index?: number;
}

export default function StatCard({
  title, value, change, changeLabel, icon: Icon, gradient, loading = false, index = 0,
}: StatCardProps) {
  const [hovered, setHovered] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const displayValue = useCountUp(loading ? 0 : value, 1200);
  const positive = change >= 0;

  if (loading) {
    return (
      <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 2.5 }}>
          <Skeleton variant="circular" width={44} height={44} sx={{ mb: 2 }} />
          <Skeleton width="60%" height={20} sx={{ mb: 1 }} />
          <Skeleton width="40%" height={36} sx={{ mb: 1 }} />
          <Skeleton width="70%" height={16} />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.07, ease: 'easeOut' }}
        style={{ height: '100%' }}
      >
        <Card
          elevation={0}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => setModalOpen(true)}
          sx={{
            borderRadius: 3,
            cursor: 'pointer',
            border: '1px solid',
            borderColor: hovered ? 'primary.main' : 'divider',
            transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
            transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
            boxShadow: hovered
              ? '0 12px 32px rgba(59,130,246,0.15)'
              : '0 1px 3px rgba(0,0,0,0.08)',
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Gradient accent top */}
          <Box
            sx={{
              height: hovered ? 6 : 4,
              background: gradient,
              transition: 'height 0.25s ease',
            }}
          />

          {/* Background glow */}
          <Box
            sx={{
              position: 'absolute', inset: 0, opacity: hovered ? 0.06 : 0,
              background: gradient, transition: 'opacity 0.3s ease', pointerEvents: 'none',
            }}
          />

          <CardContent sx={{ p: 2.5, position: 'relative' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
              <Box
                sx={{
                  width: 46, height: 46, borderRadius: 2.5,
                  background: gradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  transition: 'transform 0.25s ease',
                  transform: hovered ? 'scale(1.1) rotate(5deg)' : 'scale(1)',
                }}
              >
                <Icon sx={{ fontSize: 22, color: 'white' }} />
              </Box>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.4,
                  px: 1, py: 0.4, borderRadius: 2,
                  background: positive ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                }}
              >
                {positive
                  ? <TrendingUp sx={{ fontSize: 14, color: '#22c55e' }} />
                  : <TrendingDown sx={{ fontSize: 14, color: '#ef4444' }} />
                }
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: positive ? '#22c55e' : '#ef4444' }}>
                  {positive ? '+' : ''}{change}%
                </Typography>
              </Box>
            </Box>

            <Typography sx={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1, mb: 0.5 }}>
              {displayValue.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.9rem', mb: 0.5 }}>
              {title}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem' }} color="text.disabled">
              {changeLabel}
            </Typography>
          </CardContent>
        </Card>
      </motion.div>

      {/* Detail Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} closeAfterTransition slots={{ backdrop: Backdrop }}>
        <Fade in={modalOpen}>
          <Box
            sx={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: { xs: '90%', sm: 400 },
              bgcolor: 'background.paper', borderRadius: 4,
              boxShadow: 24, p: 4, outline: 'none',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ width: 48, height: 48, borderRadius: 3, background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon sx={{ fontSize: 24, color: 'white' }} />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
              </Box>
              <IconButton onClick={() => setModalOpen(false)} size="small">
                <Close fontSize="small" />
              </IconButton>
            </Box>
            <Typography sx={{ fontSize: '3rem', fontWeight: 800, mb: 1 }}>{value.toLocaleString()}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {positive ? <TrendingUp sx={{ color: '#22c55e' }} /> : <TrendingDown sx={{ color: '#ef4444' }} />}
              <Typography sx={{ color: positive ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                {positive ? '+' : ''}{change}% {changeLabel}
              </Typography>
            </Box>
          </Box>
        </Fade>
      </Modal>
    </>
  );
}
