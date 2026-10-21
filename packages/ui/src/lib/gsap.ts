'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

/**
 * The one place GSAP is set up (2026-10-21). Import `gsap` and `useGSAP`
 * from here, never from the packages, so plugins are registered once.
 * `useGSAP` scopes every tween to the component and reverts it on unmount.
 */
gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };
