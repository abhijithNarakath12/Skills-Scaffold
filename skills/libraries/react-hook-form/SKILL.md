---
name: react-hook-form
description: Build performant, accessible forms with react-hook-form 7 - useForm setup, register vs Controller for native and custom inputs, zodResolver validation, validation modes, dynamic lists with useFieldArray, watch/useWatch and re-render control, error display, accessibility, and testing with Testing Library. Load when a project depends on react-hook-form or when creating or debugging forms, validation, or form submission in React.
---

# react-hook-form 7

Assumes `react-hook-form` 7.x with TypeScript, usually paired with `zod` + `@hookform/resolvers`. Works with React 18/19, Next.js (client components), React Native.

## When to use

- Creating forms with validation, default values, async submission, server errors.
- Integrating UI libraries (shadcn/ui, MUI, Chakra, Mantine, Radix, react-select, date pickers) that are not native inputs.
- Dynamic fields (add/remove rows), wizards/multi-step forms, dependent fields.
- Fixing form performance (re-render on every keystroke) or accessibility of error messages.
- Testing forms.

## Project conventions to detect first

1. Versions: `react-hook-form` (7.5x+ supports newer resolver typing), `@hookform/resolvers` (v3 vs v5; v5 requires RHF 7.55+), schema lib (`zod`, `yup`, `valibot`).
2. Form component abstraction: shadcn/ui `Form`, `FormField`, `FormItem`, `FormMessage` (wraps `Controller` + `FormProvider`), a custom `Field` component, or raw `register`. Reuse it.
3. Validation strategy: `resolver` with a shared schema vs inline `register` rules. Prefer the schema (shared with the API).
4. Submission: client `onSubmit` calling an API, Next.js server actions (`action` + `useActionState`), or a mutation hook (TanStack Query/RTK Query).
5. Default values source: static, loaded async (`values` prop or `reset` after fetch), or URL state.
6. Devtools: `@hookform/devtools` `<DevTool control={control} />`.
7. Testing: Testing Library + `userEvent`; `msw` for network.

## Core guidance

### Setup and typing

```tsx
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  age: z.coerce.number().int().min(18),           // inputs produce strings; coerce in schema
  newsletter: z.boolean().default(false),
});
type FormInput = z.input<typeof schema>;          // what the fields hold
type FormOutput = z.output<typeof schema>;        // what onSubmit receives

export function SignupForm({ onDone }: { onDone: () => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError, reset } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', age: 18, newsletter: false },
    mode: 'onTouched',
  });

  const onSubmit: SubmitHandler<FormOutput> = async (data) => {
    const res = await api.signup(data);
    if (!res.ok) {
      if (res.fieldErrors) for (const [name, message] of Object.entries(res.fieldErrors)) setError(name as keyof FormInput, { message });
      else setError('root.server', { message: res.message });
      return;
    }
    reset();
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} {...register('email')} />
      {errors.email && <p id="email-error" role="alert">{errors.email.message}</p>}

      <label htmlFor="age">Age</label>
      <input id="age" type="number" inputMode="numeric" {...register('age')} />
      {errors.age && <p role="alert">{errors.age.message}</p>}

      <label><input type="checkbox" {...register('newsletter')} /> Newsletter</label>

      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}
      <button type="submit" disabled={isSubmitting}>Sign up</button>
    </form>
  );
}
```

- Always provide `defaultValues` for every field (controlled/uncontrolled warnings and `reset()` behaviour depend on them). For async data use `values: data` (re-syncs when it changes) or `reset(data)` in an effect after loading; prefer `values`.
- Three generics `useForm<Input, Context, Output>` make `handleSubmit` deliver the transformed/coerced type. With older resolvers (v3) and no transforms, `useForm<z.infer<typeof schema>>` is enough.
- `noValidate` on `<form>` so the browser does not block submission before RHF shows its own messages (still use `type="email"`, `inputMode` for mobile keyboards).
- `handleSubmit` runs validation and only calls `onSubmit` with valid data; it also awaits the promise so `isSubmitting` is correct. Use `handleSubmit(onValid, onInvalid)` to focus/announce errors.

### register vs Controller

- `register('name')` for native `<input>`, `<select>`, `<textarea>`: uncontrolled, fastest. Options: `{ valueAsNumber: true, valueAsDate: true, setValueAs: fn, disabled, required, ... }` when no resolver.
- `Controller` (or `useController`) for components that do not expose a DOM `ref`/`onChange(event)` pair: react-select, MUI `TextField` with custom handlers, date pickers, Radix/shadcn `Select`, `Switch`, `Checkbox`, rich text editors.

```tsx
<Controller
  name="country"
  control={control}
  render={({ field, fieldState }) => (
    <Select options={countries} value={countries.find((c) => c.value === field.value) ?? null} onChange={(opt) => field.onChange(opt?.value)} onBlur={field.onBlur} ref={field.ref} aria-invalid={fieldState.invalid} />
  )}
/>
```

- Always wire `field.onBlur` (for `onTouched`/`onBlur` modes) and `field.ref` (for `setFocus` and focusing the first error).
- Nested names: `'address.street'`, arrays `'items.0.qty'`; types are inferred via `Path<FormInput>`.
- Reusable field components: `useFormContext()` + `FormProvider` so deep children can access `control` without prop drilling; keep the provider at the form root only.

### Validation modes and behaviour

- `mode`: `'onSubmit'` (default; validates on submit, then re-validates per `reValidateMode`), `'onBlur'`, `'onChange'` (re-renders per keystroke), `'onTouched'` (good default: first blur, then on change), `'all'`.
- `reValidateMode`: `'onChange'` default after first submit.
- `criteriaMode: 'all'` to collect every failing rule per field (`errors.x.types`).
- `shouldFocusError: true` (default) focuses the first invalid field on submit; requires `ref` wiring on custom inputs.
- `trigger('field')` for manual validation (step wizards); `clearErrors`, `setError` for server-side errors; `setError('root.x')` for form-level errors that clear on next submit.
- Cross-field rules belong in the schema (`refine` with `path`); with no schema use `validate: (value, formValues) => ...` in `register`.
- `disabled` on `useForm` or `register` disables inputs and excludes them from validation and submission data.

### Dynamic fields (useFieldArray)

```tsx
const { fields, append, remove, move } = useFieldArray({ control, name: 'items' });
{fields.map((f, i) => (
  <div key={f.id}>                                              // use f.id, never the index
    <input {...register(`items.${i}.name` as const)} />
    <input type="number" {...register(`items.${i}.qty` as const, { valueAsNumber: true })} />
    {errors.items?.[i]?.qty && <p role="alert">{errors.items[i]?.qty?.message}</p>}
    <button type="button" onClick={() => remove(i)}>Remove</button>
  </div>
))}
<button type="button" onClick={() => append({ name: '', qty: 1 })}>Add</button>
{errors.items?.root && <p role="alert">{errors.items.root.message}</p>}   // array-level errors (min length)
```

- Field array items must be objects; a flat `string[]` must be wrapped (`{ value: string }[]`).
- Use `field.id` as `key`; do not call `append`/`remove` in the same tick repeatedly without awaiting state (they are stack-based actions; batch with `replace`).
- `watch('items')` for totals, or `useWatch({ control, name: 'items' })` in a child to isolate re-renders.

### Performance and re-renders

- `register` is uncontrolled: typing does not re-render the form. Subscribing to `formState` (destructuring `errors`, `isDirty`, `isValid`) and `watch()` at the root re-renders on relevant changes; that is normal but keep heavy UI out of the root component.
- `watch('x')` in the root re-renders the whole form on every change of `x`; prefer `useWatch({ control, name: 'x' })` inside the small component that needs it. `useFormState({ control, name })` likewise for isolated `errors`/`isDirty`.
- `formState` is a Proxy: only read properties are subscribed; read it inside render (not in callbacks) so subscriptions register.
- `shouldUnregister: false` (default) keeps values of unmounted fields (wizards); set `true` if hidden fields must drop out of the payload.
- Avoid `mode: 'onChange'` plus expensive schemas on large forms; use `'onTouched'`.

### Accessibility

- Every input has a `<label htmlFor>`; group radios/checkboxes in `<fieldset><legend>`.
- Errors: `aria-invalid` on the input, `aria-describedby` pointing at the message, message element with `role="alert"` (or a live region for summaries). Focus the first error on failed submit (default) and announce success.
- Keep native semantics: `<button type="submit">`, `type="button"` for add/remove so Enter does not trigger them.
- `autoComplete` tokens (`email`, `given-name`, `postal-code`, `one-time-code`) and `inputMode` for mobile.

### Testing

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

it('shows a validation error and submits valid data', async () => {
  const user = userEvent.setup();
  render(<SignupForm onDone={onDone} />);
  await user.click(screen.getByRole('button', { name: /sign up/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email/i);
  await user.type(screen.getByLabelText(/email/i), 'a@b.co');
  await user.clear(screen.getByLabelText(/age/i));
  await user.type(screen.getByLabelText(/age/i), '30');
  await user.click(screen.getByRole('button', { name: /sign up/i }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
});
```

- Query by label/role; wait with `findBy*`/`waitFor` because validation and submission are async.
- Test the schema separately with `safeParse` for edge cases; test the component for wiring and messages.
- Mock the network with `msw`, not RHF.

## Common tasks

### Create a form

1. Schema + types (`z.input`/`z.output`) in a colocated `schema.ts` (shared with the API when possible).
2. `useForm` with `resolver`, `defaultValues`, `mode: 'onTouched'`.
3. Native inputs with `register`; custom components with `Controller` (or the project's `FormField` wrapper).
4. Error messages wired with `aria-describedby`; disabled submit while `isSubmitting`; server errors via `setError`.
5. Test: invalid submit shows errors; valid submit calls the API.

### Edit form with async initial data

`const { data } = useQuery(...)`; `useForm({ values: data, resetOptions: { keepDirtyValues: true } })`. Show a skeleton until `data` exists, or render the form only when loaded.

### Multi-step wizard

One `useForm` at the top with `FormProvider`; each step renders its fields and calls `trigger([...stepFields])` before advancing; `shouldUnregister: false` to keep values across steps.

### Integrate with shadcn/ui

Use the generated `Form` components: `<Form {...form}><form onSubmit={form.handleSubmit(onSubmit)}><FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel/><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} /></form></Form>`. `FormControl` wires ids and aria attributes automatically.

### Next.js server action

`<form action={formAction}>` with `useActionState` for progressive enhancement, or keep RHF client-side and call the action inside `onSubmit` (`await action(data)`), mapping returned field errors with `setError`.

## Pitfalls

- Missing `defaultValues`: inputs switch from uncontrolled to controlled, `reset()` resets to `undefined`, `isDirty` is wrong.
- Using `watch()` at the form root for one field; the whole form re-renders per keystroke. Use `useWatch`.
- Spreading `{...register('x')}` onto a custom component that does not forward `ref`/`onChange(event)`; use `Controller`.
- Number inputs returning strings; use `valueAsNumber` or `z.coerce.number()`. Empty number input yields `NaN` with `valueAsNumber`; handle it in the schema (`z.number().or(z.nan())` or `setValueAs`).
- Index as `key` in field arrays; inputs keep stale values after `remove`.
- Calling `setValue` without `{ shouldValidate: true, shouldDirty: true }` and expecting errors/dirty state to update.
- Zod `refine` without `path`; cross-field errors land on the root and never display next to a field.
- Resolver typing mismatch after upgrading `@hookform/resolvers` to v5 (requires RHF 7.55+ and the three-generic `useForm` for transforms).
- Using `errors` inside `useEffect` dependencies; it is a Proxy and changes identity, causing loops.
- `handleSubmit` not awaited in tests, asserting before validation finished.
- Resetting with `reset()` immediately after submit before the submit promise resolves; `reset` inside `onSubmit` after awaiting the API, or use `isSubmitSuccessful` in an effect.

## Verification

```bash
npx tsc --noEmit          # field paths and generics
npm run lint              # jsx-a11y rules for labels/aria
npm test                  # Testing Library + userEvent + msw
npm run build
```

Manually: keyboard-only pass through the form, screen reader announces errors, submit button disabled while pending.

## References

- react-hook-form docs: https://react-hook-form.com/docs
- useForm options (mode, values, shouldUnregister): https://react-hook-form.com/docs/useform
- Controller: https://react-hook-form.com/docs/usecontroller/controller
- useFieldArray: https://react-hook-form.com/docs/usefieldarray
- Advanced usage (accessibility, wizard, performance): https://react-hook-form.com/advanced-usage
- Resolvers: https://github.com/react-hook-form/resolvers
