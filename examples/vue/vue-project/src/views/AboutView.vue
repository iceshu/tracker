<template>
  <div class="about">
    <h1>This is an about page</h1>
    <button @click="handleClick">点击报错</button>
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
const handleClick = () => {
  console.log(a)
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
