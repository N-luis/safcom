'use client';

import React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button';
import LoginIcon from "@mui/icons-material/Login";

export default function DashboardPage() {
  const router = useRouter();
    return (
    <Button type="button"
                    onClick={() => router.push('/dashboard')}
                    fullWidth
                    variant="contained"
                    endIcon={<LoginIcon />}
                    sx={{
                      py: 1.7,
                      borderRadius: "12px",
                      textTransform: "none",
                      fontWeight: 700,
                      fontSize: "1rem",
                      backgroundColor: "#00796b",
                      boxShadow:
                        "0 10px 25px rgba(0,121,107,0.25)",
                      "&:hover": {
                        backgroundColor: "#00695c",
                      },
                    }}
                  >
                    Log in
                  </Button>
  )
}
