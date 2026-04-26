<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	import type { WithoutChild } from 'bits-ui';
	let {
		class: className,
		children,
		...restProps
	}: WithoutChild<TabsPrimitive.ContentProps> = $props();
</script>

<TabsPrimitive.Content
	class={cn(
		'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.Content>
