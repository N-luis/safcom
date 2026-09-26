'use client';

import React from 'react'
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Button from "@mui/material/Button";
import { useRouter } from 'next/navigation';

export default function CreatePage() {
  const router = useRouter();
    return (
    <Button 
        type="button"
        onClick={() => router.push('/sign')}
        fullWidth
        variant="contained"
        endIcon={<ArrowForwardIcon />}
                        sx={{
                          py: 1.8,
                          borderRadius: "12px",
                          backgroundColor:
                            "#00796b",
                          textTransform: "none",
                          fontSize: "1rem",
                          fontWeight: 700,
                          mt: 1,
                          "&:hover": {
                            backgroundColor:
                              "#00695c",
                          },
                        }}
                      >
                        Create Account
                      </Button>
  )
}
