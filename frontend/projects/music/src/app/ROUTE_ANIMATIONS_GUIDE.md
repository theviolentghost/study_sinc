# Route Animation Guide

This guide explains how to customize the sliding transitions between routes in your Angular application.

## Current Setup

Your app now has sliding transitions that work both horizontally (left-right) and vertically (top-bottom).

### Current Transitions

**Horizontal (Left to Right):**
- `playlists` → `searches` (slides left)
- `searches` → `settings` (slides left)

**Horizontal (Right to Left):**
- `searches` → `playlists` (slides right)
- `settings` → `searches` (slides right)

**Vertical (Top to Bottom):**
- `playlists` → `settings` (slides down)
- `settings` → `playlists` (slides up)

## How to Customize

### 1. Change Animation Direction

Edit `/frontend/projects/music/src/app/route.animations.ts` to add or modify transitions.

#### Horizontal Slide (Left to Right)
When going from RouteA to RouteB, the new page slides in from the right:

```typescript
transition('routeA => routeB', [
  style({ position: 'relative' }),
  query(':enter, :leave', [
    style({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%'
    })
  ], { optional: true }),
  query(':enter', [
    style({ left: '100%' })  // Start from right
  ], { optional: true }),
  query(':leave', animateChild(), { optional: true }),
  group([
    query(':leave', [
      animate('300ms ease-out', style({ left: '-100%' }))  // Exit to left
    ], { optional: true }),
    query(':enter', [
      animate('300ms ease-out', style({ left: '0%' }))  // Enter from right
    ], { optional: true })
  ]),
  query(':enter', animateChild(), { optional: true }),
]),
```

#### Horizontal Slide (Right to Left)
Reverse direction:

```typescript
transition('routeB => routeA', [
  style({ position: 'relative' }),
  query(':enter, :leave', [
    style({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%'
    })
  ], { optional: true }),
  query(':enter', [
    style({ left: '-100%' })  // Start from left
  ], { optional: true }),
  query(':leave', animateChild(), { optional: true }),
  group([
    query(':leave', [
      animate('300ms ease-out', style({ left: '100%' }))  // Exit to right
    ], { optional: true }),
    query(':enter', [
      animate('300ms ease-out', style({ left: '0%' }))  // Enter from left
    ], { optional: true })
  ]),
  query(':enter', animateChild(), { optional: true }),
]),
```

#### Vertical Slide (Top to Bottom)

```typescript
transition('routeA => routeB', [
  style({ position: 'relative' }),
  query(':enter, :leave', [
    style({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%'
    })
  ], { optional: true }),
  query(':enter', [
    style({ top: '100%' })  // Start from bottom
  ], { optional: true }),
  query(':leave', animateChild(), { optional: true }),
  group([
    query(':leave', [
      animate('300ms ease-out', style({ top: '-100%' }))  // Exit to top
    ], { optional: true }),
    query(':enter', [
      animate('300ms ease-out', style({ top: '0%' }))  // Enter from bottom
    ], { optional: true })
  ]),
  query(':enter', animateChild(), { optional: true }),
]),
```

#### Vertical Slide (Bottom to Top)

```typescript
transition('routeB => routeA', [
  style({ position: 'relative' }),
  query(':enter, :leave', [
    style({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%'
    })
  ], { optional: true }),
  query(':enter', [
    style({ top: '-100%' })  // Start from top
  ], { optional: true }),
  query(':leave', animateChild(), { optional: true }),
  group([
    query(':leave', [
      animate('300ms ease-out', style({ top: '100%' }))  // Exit to bottom
    ], { optional: true }),
    query(':enter', [
      animate('300ms ease-out', style({ top: '0%' }))  // Enter from top
    ], { optional: true })
  ]),
  query(':enter', animateChild(), { optional: true }),
]),
```

### 2. Adjust Animation Speed

Change the duration in the `animate()` calls:
- Faster: `'200ms ease-out'`
- Current: `'300ms ease-out'`
- Slower: `'500ms ease-out'`

### 3. Change Animation Easing

Replace `ease-out` with other easing functions:
- `ease-in` - Starts slow, ends fast
- `ease-out` - Starts fast, ends slow (current)
- `ease-in-out` - Slow start and end, fast middle
- `linear` - Constant speed
- Custom cubic-bezier: `cubic-bezier(0.4, 0.0, 0.2, 1)`

### 4. Add Fade Effects

You can combine slide with fade:

```typescript
query(':enter', [
  style({ left: '100%', opacity: 0 })  // Add opacity
], { optional: true }),
// ...
query(':enter', [
  animate('300ms ease-out', style({ left: '0%', opacity: 1 }))  // Fade in while sliding
], { optional: true })
```

## Your Route Names

Based on your `app.routes.ts`, these are the route animation names:
- `playlists`
- `searches`
- `settings`
- `home`
- `discover`
- `artist`
- `track`
- `album`

## Examples

### Example 1: All horizontal navigation
If you want all main navigation to slide horizontally:

```typescript
// playlists (left) → searches (middle) → settings (right)
transition('playlists => searches', [...]) // slide left
transition('searches => playlists', [...]) // slide right
transition('searches => settings', [...]) // slide left
transition('settings => searches', [...]) // slide right
transition('playlists => settings', [...]) // slide left (skip middle)
transition('settings => playlists', [...]) // slide right (skip middle)
```

### Example 2: Vertical for modal-like pages
Settings could slide up from the bottom:

```typescript
transition('* => settings', [
  // Slide up from bottom
  query(':enter', [style({ top: '100%' })], { optional: true }),
  group([
    query(':leave', [animate('300ms ease-out', style({ opacity: 0.5 }))], { optional: true }),
    query(':enter', [animate('300ms ease-out', style({ top: '0%' }))], { optional: true })
  ]),
])
```

### Example 3: Wildcard transitions
Use `*` for any route:

```typescript
// Any route to settings slides up
transition('* => settings', [...])

// Settings to any route slides down
transition('settings => *', [...])
```

## Troubleshooting

### Animations not working?
1. Check browser console for errors
2. Ensure `provideAnimations()` is in `app.config.ts` (✓ Already added)
3. Verify route data matches animation names
4. Check that `.content-container` has `position: relative` (✓ Already added)

### Choppy animations?
1. Reduce animation duration
2. Ensure no heavy operations during route changes
3. Use `transform` instead of `left/top` for better performance:
   ```typescript
   style({ transform: 'translateX(100%)' })
   animate('300ms ease-out', style({ transform: 'translateX(0)' }))
   ```

### Routes don't animate in the right direction?
Make sure the transition is defined for both directions (A→B and B→A).

## Performance Tip

For better performance, use CSS transforms instead of left/top positioning:

```typescript
// Instead of: left: '100%'
// Use: transform: 'translateX(100%)'

query(':enter', [
  style({ transform: 'translateX(100%)' })
], { optional: true }),
group([
  query(':leave', [
    animate('300ms ease-out', style({ transform: 'translateX(-100%)' }))
  ], { optional: true }),
  query(':enter', [
    animate('300ms ease-out', style({ transform: 'translateX(0)' }))
  ], { optional: true })
]),
```

This uses GPU acceleration for smoother animations!
