
"use client";

import React, { useState } from "react";

import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Container from "@mui/material/Container";
import CssBaseline from "@mui/material/CssBaseline";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import Visibility from "@mui/icons-material/Visibility";
import { useRouter } from 'next/navigation'



export default function RegisterPage() {
  const router = useRouter();
    const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  return (
    <>
      <CssBaseline />

      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "#f5f7f8",
        }}
      >
        {/* NAVBAR */}
        <AppBar
          position="static"
          elevation={0}
          sx={{
            backgroundColor: "#ffffff",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <Toolbar
            sx={{
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            {/* LEFT */}
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "center",
              }}
            >
              <ShieldOutlinedIcon
                sx={{
                  color: "#00796b",
                }}
              />

              <Typography
                variant="h6"
                sx={{
                  color: "#111827",
                  fontWeight: 700,
                }}
              >
                SafeComm
              </Typography>
            </Stack>

            {/* RIGHT */}
            <Stack
              direction="row"
              spacing={3}
              sx={{
                alignItems: "center",
              }}
            >
             {/* <Typography
                sx={{
                  color: "#6b7280",
                  cursor: "pointer",
                }}
              >
                Login
              </Typography> 

             <Typography
                sx={{
                  color: "#00796b",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Register
              </Typography> */}
            </Stack>
          </Toolbar>
        </AppBar>

        {/* MAIN */}
        <Container
          maxWidth="lg"
          sx={{
            py: 6,
          }}
        >
          <Grid
            container
            spacing={4}
            sx={{
              justifyContent: "center",
            }}
          >
            {/* LEFT PANEL */}
            <Grid
              size={{
                xs: 12,
                md: 4,
              }}
            >
              <Card
                sx={{
                  borderRadius: "24px",
                  background:
                    "linear-gradient(180deg, #0f172a 0%, #111827 100%)",
                  color: "#ffffff",
                  minHeight: 430,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <CardContent
                  sx={{
                    p: 4,
                    position: "relative",
                    zIndex: 2,
                  }}
                >
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 700,
                      mb: 3,
                    }}
                  >
                    Join your Community
                  </Typography>

                  <Typography
                    sx={{
                      color: "#cbd5e1",
                      lineHeight: 1.9,
                      mb: 6,
                    }}
                  >
                    Access barangay updates, report cases
                    instantly, and stay safe with
                    SafeComm&apos;s real-time alert
                    system.
                  </Typography>

                  {/* FEATURES */}
                  <Stack spacing={3}>
                    {/* FEATURE 1 */}
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{
                        alignItems: "center",
                      }}
                    >
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          backgroundColor:
                            "rgba(0,121,107,0.18)",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <VerifiedUserOutlinedIcon
                          sx={{
                            color: "#00bfa5",
                          }}
                        />
                      </Box>

                      <Typography>
                        Verified Profiles
                      </Typography>
                    </Stack>

                    {/* FEATURE 2 */}
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{
                        alignItems: "center",
                      }}
                    >
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          backgroundColor:
                            "rgba(0,121,107,0.18)",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <ShieldOutlinedIcon
                          sx={{
                            color: "#00bfa5",
                          }}
                        />
                      </Box>

                      <Typography>
                        Secure Communication
                      </Typography>
                    </Stack>
                  </Stack>
                </CardContent>

                {/* DECORATION */}
                <Box
                  sx={{
                    position: "absolute",
                    width: 240,
                    height: 240,
                    borderRadius: "50%",
                    border:
                      "12px solid rgba(255,255,255,0.06)",
                    bottom: -40,
                    right: -40,
                  }}
                />
              </Card>
            </Grid>

            {/* RIGHT PANEL */}
            <Grid
              size={{
                xs: 12,
                md: 8,
              }}
            >
              <Card
                sx={{
                  borderRadius: "24px",
                  border: "1px solid #e5e7eb",
                  boxShadow:
                    "0px 6px 24px rgba(0,0,0,0.05)",
                }}
              >
                <CardContent
                  sx={{
                    p: {
                      xs: 3,
                      md: 5,
                    },
                  }}
                >
                  {/* HEADER */}
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 700,
                      color: "#111827",
                    }}
                  >
                    Resident Registration
                  </Typography>

                  <Typography
                    sx={{
                      color: "#6b7280",
                      mt: 1,
                      mb: 5,
                    }}
                  >
                    Complete the form below to create
                    your official barangay account.
                  </Typography>

                  {/* FORM */}
                  <Grid
                    container
                    spacing={3}
                  >
                    {/* FULL NAME */}
                    <Grid
                      size={{
                        xs: 12,
                        md: 6,
                      }}
                    >
                      <Typography
                        sx={{
                          mb: 1,
                          fontWeight: 700,
                          fontSize: "0.85rem",
                        }}
                      >
                        FULL NAME
                      </Typography>

                      <TextField
                        fullWidth
                        placeholder="John Doe"
                      />
                    </Grid>

                    {/* CONTACT */}
                    <Grid
                      size={{
                        xs: 12,
                        md: 6,
                      }}
                    >
                      <Typography
                        sx={{
                          mb: 1,
                          fontWeight: 700,
                          fontSize: "0.85rem",
                        }}
                      >
                        CONTACT NUMBER
                      </Typography>

                      <TextField
                        fullWidth
                        placeholder="+63 900 000 0000"
                      />
                    </Grid>

                    {/* ADDRESS */}
                    <Grid
                      size={{
                        xs: 12,
                      }}
                    >
                      <Typography
                        sx={{
                          mb: 1,
                          fontWeight: 700,
                          fontSize: "0.85rem",
                        }}
                      >
                        RESIDENTIAL ADDRESS
                      </Typography>

                      <TextField
                        fullWidth
                        placeholder="House No., Street, Barangay, City"
                      />
                    </Grid>

                    {/* EMAIL */}
                    <Grid
                      size={{
                        xs: 12,
                      }}
                    >
                      <Typography
                        sx={{
                          mb: 1,
                          fontWeight: 700,
                          fontSize: "0.85rem",
                        }}
                      >
                        EMAIL ADDRESS
                      </Typography>

                      <TextField
                        fullWidth
                        placeholder="resident@safecomm.ph"
                      />
                    </Grid>

                    {/* PASSWORD */}
                    <Grid
                      size={{
                        xs: 12,
                        md: 6,
                      }}
                    >
                      <Typography
                        sx={{
                          mb: 1,
                          fontWeight: 700,
                          fontSize: "0.85rem",
                        }}
                      >
                        PASSWORD
                      </Typography>

                     <TextField
                         label="Password"
                    type={showPassword ? 'text' : 'password'}
                    slotProps={{
                  input: { // This targets the 'Input' slot specifically
                 endAdornment: (
                  <InputAdornment position="end">
                <IconButton
                     aria-label="toggle password visibility"
                    onClick={() => setShowPassword((prev) => !prev)}
                     edge="end"
                     >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                    </InputAdornment>
                            ),
                        },
                     }}
                    />
                    </Grid>

                    {/* CONFIRM PASSWORD */}
                    <Grid
                      size={{
                        xs: 12,
                        md: 6,
                      }}
                    >
                      <Typography
                        sx={{
                          mb: 1,
                          fontWeight: 700,
                          fontSize: "0.85rem",
                        }}
                      >
                        CONFIRM PASSWORD
                      </Typography>

                      <TextField
                         label="Password"
                        type={showPassword ? 'text' : 'password'}
                        slotProps={{
                        input: { // This targets the 'Input' slot specifically
                     endAdornment: (
                <InputAdornment position="end">
                    <IconButton
                        aria-label="toggle password visibility"
                            onClick={() => setShowPassword((prev) => !prev)}
                            edge="end"
                            >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                </InputAdornment>
                        ),
                    },
                }}
            />
                    </Grid>

                    {/* FILE UPLOAD */}
                    <Grid
                      size={{
                        xs: 12,
                      }}
                    >
                      <Box
                        sx={{
                          border:
                            "2px dashed #d1d5db",
                          borderRadius: "16px",
                          p: 5,
                          textAlign: "center",
                          backgroundColor: "#fafafa",
                        }}
                      >
                        <CloudUploadOutlinedIcon
                          sx={{
                            fontSize: 42,
                            color: "#6b7280",
                            mb: 2,
                          }}
                        />

                        <Typography
                          variant="h6"
                          sx={{
                            color: "#374151",
                            mb: 1,
                          }}
                        >
                          Upload Valid ID
                          (Optional)
                        </Typography>

                        <Typography
                          sx={{
                            color: "#9ca3af",
                            fontSize: "0.9rem",
                            mb: 3,
                          }}
                        >
                          Accepted: Passport,
                          Driver&apos;s License,
                          National ID (Max 5MB)
                        </Typography>

                        <Button
                          variant="text"
                          sx={{
                            textTransform: "none",
                            fontWeight: 700,
                            color: "#00796b",
                          }}
                        >
                          Browse files
                        </Button>
                      </Box>
                    </Grid>

                    {/* PRIVACY */}
                    <Grid
                      size={{
                        xs: 12,
                      }}
                    >
                      <Box
                        sx={{
                          border:
                            "1px solid #99f6e4",
                          backgroundColor:
                            "#f0fdfa",
                          borderRadius: "16px",
                          p: 3,
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={2}
                        >
                          <ShieldOutlinedIcon
                            sx={{
                              color: "#00796b",
                            }}
                          />

                          <Box>
                            <Typography
                              sx={{
                                fontWeight: 700,
                                color: "#00796b",
                                mb: 1,
                              }}
                            >
                              PRIVACY & SECURITY
                            </Typography>

                            <Typography
                              sx={{
                                color: "#0f766e",
                                fontSize:
                                  "0.9rem",
                                lineHeight: 1.7,
                              }}
                            >
                              Your data is protected
                              under the Data Privacy
                              Act. We use
                              industry-standard
                              encryption to ensure
                              your personal
                              information remains
                              confidential.
                            </Typography>
                          </Box>
                        </Stack>
                      </Box>
                    </Grid>

                    {/* BUTTON */}
                    <Grid
                      size={{
                        xs: 12,
                      }}
                    >
                      <Button 
                      type="button"
                        onClick={() => router.push('/sign')}
                        fullWidth
                        variant="contained"
                        endIcon={
                          <ArrowForwardIcon />
                        }
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

                      <Typography
                        align="center"
                        sx={{
                          mt: 3,
                          color: "#9ca3af",
                          fontSize: "0.85rem",
                        }}
                      >
                        By clicking
                        &quot;Create
                        Account&quot;, you agree to
                        our Terms of Service and
                        Privacy Policy.
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Container>

        {/* FOOTER */}
        <Divider />

        <Box
          sx={{
            py: 4,
            textAlign: "center",
            color: "#9ca3af",
            fontSize: "0.9rem",
          }}
        >
          © 2024 SafeComm Institutional. All
          Rights Reserved.
        </Box>
      </Box>
    </>
  );
}
