<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';

	let { ...restProps }: TabsPrimitive.RootProps = $props();
</script>

<TabsPrimitive.Root {...restProps}>
	{@render restProps.children?.()}
</TabsPrimitive.Root>
