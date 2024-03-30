<template>
  <div class="about">
    <h1>This is an about page</h1>
  </div>
</template>
<script lang="ts" setup>
import axios from 'axios'
import { onMounted } from 'vue'

const requetFn = () => {
  axios.post('/api/test', { aaa: 1 }).then((res: any) => {
    console.log(res)
  })
}
onMounted(() => {
  console.log('ffff')
  requetFn()
})
</script>
<style>
@media (min-width: 1024px) {
  .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  }
}
</style>
