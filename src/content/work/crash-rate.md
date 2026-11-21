---
title: Halving the Instagram Android crash rate
description: An Instagram-wide crash workstream that cut the crash rate in half by building prevention, not by fixing crashes one at a time.
date: 2026-12-01 # TODO: set the publish date, then remove `draft`
draft: true
pinned: true
claim: Stable
figure: '½'
figureLabel: crash rate, Instagram Android
tags: [crash-prevention]
credits: 'TODO: credit teammates by role, e.g. "Two engineers on the null-safety tooling; the app-health data scientist who built the attribution."'
---

<!-- 600 to 900 words, written as a postmortem. Each section a short paragraph or two.
     Publish bar: the problem, the action, the number and what you'd change. Check
     any Meta internals for confidentiality first. Relative numbers only. -->

## Summary

I led the Instagram-wide crash workstream. Over TODO: how long, the Android crash rate fell by half and null-pointer exceptions fell about 3×.

## Timeline

TODO: three to six dated beats. When the work started, the first measurable drop, the point it held.

## Detection

TODO: how the crash rate came to be the problem. What signal said it was a workstream and not a bug queue.

## Root cause

TODO: why the crashes kept coming. The case for prevention: a class of bug, not a list of bugs.

## Fix

TODO: what was built. Null safety, ANR work, leak detection: which, and in what order.

## Prevention

TODO: what stops it coming back. The guard rails, the dashboards, who owns the number now.

## What went wrong or I'd change

TODO: the honest section. What took longer than it should, what you'd do first next time.
