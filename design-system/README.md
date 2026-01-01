# FrameFlow Design System

Centralized UI components and styling for all FrameFlow modules.

## Structure

- `css/` - Theme, components, and layout styles
- `components/` - EJS templates (navbar, layout, forms, etc)
- `js/` - Utility functions

## Usage

### In a FrameFlow app

```javascript
// Set view engine and view path
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../../design-system/components'));

// Render with shared layout
res.render('layout', {
    body: htmlContent,
    user: req.session.user,
    domain: process.env.DOMAIN
});
```

### CSS

```html
<link rel="stylesheet" href="/design-system/css/theme.css">
<link rel="stylesheet" href="/design-system/css/components.css">
<link rel="stylesheet" href="/design-system/css/layout.css">
```

## Components

### Navbar
- Auto-detects user roles and shows available modules
- Responsive design
- User dropdown with logout

### Forms
- Consistent input styling
- Button variants (primary, secondary, outline, etc)
- Form groups with labels

### Cards
- Consistent padding and shadows
- Header/body/footer sections

### Alerts
- Success, danger, warning, info variants
- Built-in icons

## CSS Variables

All colors, spacing, and sizing use CSS variables defined in `theme.css`. Override at app level if needed.

```css
:root {
    --primary-color: #3b82f6;
    --spacing-lg: 16px;
    /* ... */
}
```
