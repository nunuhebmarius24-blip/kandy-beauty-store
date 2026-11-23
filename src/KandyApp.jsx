import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './lib/supabase'
import './styles.css'

const WA = '264818083594'
const money = n => 'N$' + Number(n || 0).toFixed(2)
const emptyProduct = { name:'', category:'Gloss', price:'', shade:'', description:'', stock:'0', tag:'', published:false, image_url:'' }

function App() {
  const [page,setPage] = useState('Home')
  const [products,setProducts] = useState([])
  const [filter,setFilter] = useState('All')
  const [cart,setCart] = useState(()=>{ try{return JSON.parse(localStorage.getItem('kandy-cart')||'[]')}catch{return []} })
  const [selected,setSelected] = useState(null)
  const [notice,setNotice] = useState('')
  const [loading,setLoading] = useState(true)
  const [customer,setCustomer] = useState({name:'',town:'',note:''})
  const [session,setSession] = useState(null)
  const [adminAllowed,setAdminAllowed] = useState(false)
  const [adminEmail,setAdminEmail] = useState('nunuhebmarius24@gmail.com')
  const [adminPassword,setAdminPassword] = useState('')
  const [adminTab,setAdminTab] = useState('products')
  const [orders,setOrders] = useState([])
  const [editing,setEditing] = useState(null)
  const [productForm,setProductForm] = useState(emptyProduct)
  const [saving,setSaving] = useState(false)

  const refreshProducts = async () => {
    let query = supabase.from('products').select('*').order('created_at',{ascending:false})
    if(!adminAllowed) query = query.eq('published',true)
    const {data,error} = await query
    if(error) setNotice('Could not load products: '+error.message)
    else setProducts(data || [])
    setLoading(false)
  }
  useEffect(()=>{
    refreshProducts()
    supabase.auth.getSession().then(({data})=>setSession(data.session))
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next)=>setSession(next))
    return ()=>subscription.unsubscribe()
  },[])
  useEffect(()=>{ localStorage.setItem('kandy-cart',JSON.stringify(cart)) },[cart])
  useEffect(()=>{
    let active = true
    async function checkAdmin(){
      if(!session?.user){ if(active){setAdminAllowed(false);setOrders([])} return }
      const {data,error} = await supabase.from('admin_users').select('user_id').eq('user_id',session.user.id).maybeSingle()
      if(active){setAdminAllowed(!error && !!data); if(data) loadOrders()}
    }
    checkAdmin()
    return ()=>{active=false}
  },[session])
  const count = cart.reduce((s,x)=>s+x.qty,0)
  const total = cart.reduce((s,x)=>s+Number(x.price)*x.qty,0)
  const shown = useMemo(()=>products.filter(p=>filter==='All'||p.category===filter),[products,filter])
  const go = p=>{setPage(p);window.scrollTo({top:0,behavior:'smooth'})}
  function notify(message){setNotice(message);window.setTimeout(()=>setNotice(''),3500)}
  function add(p){setCart(old=>{const found=old.find(x=>x.id===p.id);return found?old.map(x=>x.id===p.id?{...x,qty:x.qty+1}:x):[...old,{...p,qty:1}]});notify(p.name+' added to your bag')}
  function qty(id,delta){setCart(old=>old.map(x=>x.id===id?{...x,qty:Math.max(0,x.qty+delta)}:x).filter(x=>x.qty>0))}
  async function checkout(){
    if(!customer.name.trim()||!customer.town.trim()){notify('Please add your name and town first.');return}
    if(!cart.length){notify('Your bag is empty.');return}
    const lines = cart.map(x=>({product_id:x.id,quantity:x.qty}))
    const {data,error} = await supabase.rpc('place_kandy_order',{p_customer_name:customer.name.trim(),p_town:customer.town.trim(),p_note:customer.note||'',p_items:lines})
    if(error){notify(error.message);return}
    const msg = 'Hello KANDY BEAUTY! I placed order '+data.order_id+'. Total: '+money(data.total)+'. Please confirm payment and delivery details.'
    window.open('https://wa.me/'+WA+'?text='+encodeURIComponent(msg),'_blank')
    setCart([]);setCustomer({name:'',town:'',note:''});await refreshProducts();notify('Order saved! Our team will confirm with you on WhatsApp.')
  }
  async function adminLogin(e){
    e.preventDefault()
    const {error} = await supabase.auth.signInWithPassword({email:adminEmail,password:adminPassword})
    if(error) notify(error.message)
    else {setAdminPassword('');notify('Signed in. Checking administrator access…')}
  }
  async function loadOrders(){
    const {data,error} = await supabase.from('orders').select('*,order_items(*)').order('created_at',{ascending:false})
    if(error) notify('Could not load orders: '+error.message)
    else setOrders(data||[])
  }
  async function openAdmin(){
    go('Admin')
    if(session?.user && adminAllowed){await refreshProducts();await loadOrders()}
  }
  function startNewProduct(){setEditing(null);setProductForm(emptyProduct);setAdminTab('products')}
  function startEditProduct(p){setEditing(p.id);setProductForm({...p,price:String(p.price),stock:String(p.stock)});setAdminTab('products')}
  async function saveProduct(e){
    e.preventDefault();setSaving(true)
    const payload={name:productForm.name.trim(),category:productForm.category,price:Number(productForm.price),shade:productForm.shade,description:productForm.description,stock:Number(productForm.stock),tag:productForm.tag,published:productForm.published,image_url:productForm.image_url||null,updated_at:new Date().toISOString()}
    const result = editing ? await supabase.from('products').update(payload).eq('id',editing) : await supabase.from('products').insert(payload)
    setSaving(false)
    if(result.error){notify(result.error.message);return}
    notify('Product saved.');startNewProduct();await refreshProducts()
  }
  async function uploadImage(file){
    if(!file)return
    const ext=file.name.split('.').pop()||'jpg'
    const path=Date.now()+'-'+Math.random().toString(36).slice(2)+'.'+ext
    const {error}=await supabase.storage.from('product-images').upload(path,file,{upsert:false})
    if(error){notify(error.message);return}
    const {data}=supabase.storage.from('product-images').getPublicUrl(path)
    setProductForm(f=>({...f,image_url:data.publicUrl}))
    notify('Image uploaded.')
  }
  async function deleteProduct(id){
    if(!window.confirm('Delete this product?'))return
    const {error}=await supabase.from('products').delete().eq('id',id)
    if(error)notify(error.message);else{notify('Product deleted.');await refreshProducts()}
  }
  async function updateOrder(id,status){
    const {error}=await supabase.from('orders').update({status}).eq('id',id)
    if(error)notify(error.message);else{notify('Order updated.');await loadOrders()}
  }

  return <>
    <div className="announcement">A little more love, a little more gloss ✿ Welcome to KANDY BEAUTY</div>
    <header><button className="brand" onClick={()=>go('Home')}><span className="brand-mark">K</span><span>KANDY <i>BEAUTY</i><small>YOUR BEAUTY, YOUR WAY</small></span></button><nav>{['Home','Shop','About','Contact'].map(x=><button className={page===x?'active':''} onClick={()=>go(x)} key={x}>{x}</button>)}</nav><button className="bag" onClick={()=>go('Cart')}>BAG <b>{count}</b></button></header>
    {page==='Home'&&<><section className="hero"><div className="hero-copy"><span className="eyebrow">A LITTLE GLOW GOES A LONG WAY</span><h1>Feel good.<br/><em>Look glossy.</em></h1><p>Your next lip obsession is waiting. Explore feel-good beauty favourites made for every version of you.</p><button className="primary" onClick={()=>go('Shop')}>SHOP THE COLLECTION <span>↗</span></button><div className="hero-note">♡ Made for your everyday main-character moments</div></div><div className="hero-art"><div className="orb orb1"></div><div className="orb orb2"></div><div className="tube"><span>KANDY<br/>BEAUTY</span><i></i></div><div className="floating f1">GLOSS<br/>YOUR WAY</div><div className="floating f2">♡</div><div className="art-caption">THE LIP EDIT · 01</div></div></section><section className="intro"><span className="eyebrow">THE KANDY EDIT</span><h2>Beauty that feels like <em>you.</em></h2><p>From soft everyday colour to high-shine moments, find the little things that make you feel extra special.</p></section><section className="brand-story"><div className="brand-story-mark">K</div><div className="brand-story-copy"><span className="eyebrow">A LITTLE ABOUT US</span><h2>Meet <em>KANDY BEAUTY.</em></h2><p>KANDY BEAUTY is a feel-good beauty brand built around the little details that make you feel like yourself. From glossy lips to shades that match your mood, our collection is all about self-expression, everyday confidence and adding a touch of fun to your beauty routine.</p><p>Whether you love a soft, natural look or a little extra shine, there is always room for a little Kandy.</p><button className="outline" onClick={()=>go('About')}>OUR STORY ↗</button></div></section><ProductGrid items={products.slice(0,3)} add={add} open={p=>{setSelected(p);go('Product')}} loading={loading}/><div className="center"><button className="outline" onClick={()=>go('Shop')}>EXPLORE ALL PRODUCTS ↗</button></div><section className="pink-banner"><span>YOUR LIPS, YOUR RULES</span><h2>Keep it cute.<br/><em>Keep it Kandy.</em></h2><button className="primary" onClick={()=>go('Shop')}>FIND YOUR FAVOURITE</button></section></>}
    {page==='Shop'&&<><section className="page-head"><span className="eyebrow">THE COLLECTION</span><h1>Shop the <em>glow.</em></h1><p>Little beauty treats, big main-character energy.</p></section><div className="filters">{['All','Gloss','Lipstick','Liner','Tint','Care'].map(x=><button className={filter===x?'chosen':''} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div><ProductGrid items={shown} add={add} open={p=>{setSelected(p);go('Product')}} loading={loading}/></>}
    {page==='Product'&&selected&&<section className="product-detail"><div className="product-visual">{selected.image_url?<img src={selected.image_url} alt={selected.name}/>:<div className="swatch"><span>KANDY<br/>BEAUTY</span></div>}</div><div><span className="eyebrow">{selected.tag}</span><h1>{selected.name}</h1><p className="price">{money(Number(selected.price))}</p><p>{selected.description}</p><p><b>Shade:</b> {selected.shade}</p><p><b>In stock:</b> {selected.stock}</p><button className="primary" disabled={selected.stock<1} onClick={()=>add(selected)}>ADD TO BAG ↗</button><p className="small">Orders are confirmed with our team on WhatsApp.</p><button className="text-btn" onClick={()=>go('Shop')}>← Back to shop</button></div></section>}
    {page==='Cart'&&<section className="cart-page"><span className="eyebrow">YOUR LITTLE TREASURES</span><h1>Your <em>bag.</em></h1>{cart.length===0?<div className="empty"><p>Your bag is waiting for a little Kandy magic.</p><button className="primary" onClick={()=>go('Shop')}>SHOP NOW</button></div>:<div className="cart-layout"><div>{cart.map(x=><div className="cart-row" key={x.id}><div className="mini-swatch"></div><div className="cart-info"><b>{x.name}</b><small>{x.shade}</small><span>{money(Number(x.price))}</span></div><div className="quantity"><button onClick={()=>qty(x.id,-1)}>−</button>{x.qty}<button onClick={()=>qty(x.id,1)}>+</button></div><button className="remove" onClick={()=>setCart(c=>c.filter(y=>y.id!==x.id))}>Remove</button></div>)}</div><aside className="summary"><h3>Order summary</h3><p>Subtotal <b>{money(total)}</b></p><p className="small">Delivery details and any delivery fee will be confirmed on WhatsApp.</p><hr/><h2>{money(total)}</h2><label>Your name<input value={customer.name} onChange={e=>setCustomer({...customer,name:e.target.value})} placeholder="Full name"/></label><label>Your town / location<input value={customer.town} onChange={e=>setCustomer({...customer,town:e.target.value})} placeholder="e.g. Swakopmund"/></label><label>Order note (optional)<textarea value={customer.note} onChange={e=>setCustomer({...customer,note:e.target.value})} placeholder="Any extra details?"/></label><button className="primary full" onClick={checkout}>PLACE ORDER ↗</button><p className="small">No online payment is taken yet. Our team will confirm payment on WhatsApp.</p></aside></div>}</section>}
    {page==='About'&&<section className="story"><span className="eyebrow">A NOTE FROM KANDY</span><h1>Beauty, with a little <em>Kandy.</em></h1><p>KANDY BEAUTY is a feel-good beauty brand created for anyone who loves expressing themselves through the little details. We believe beauty should feel personal, playful and true to you.</p><p>From glossy lips to shades that suit your mood, our collection is about celebrating your style, enjoying your routine and giving yourself a little moment to shine.</p><p>Whether your look is soft and simple or bold and glossy, make it yours. Your beauty, your way.</p><button className="primary" onClick={()=>go('Shop')}>SHOP KANDY BEAUTY</button></section>}
    {page==='Contact'&&<section className="story"><span className="eyebrow">WE'D LOVE TO HEAR FROM YOU</span><h1>Say <em>hello.</em></h1><p>Questions about products or an order? Reach out and our team can help.</p><a className="primary link-button" href={`https://wa.me/${WA}`} target="_blank" rel="noreferrer">CHAT ON WHATSAPP ↗</a><p>Instagram: <a href="https://instagram.com/kandybeauty_na" target="_blank" rel="noreferrer">@kandybeauty_na</a></p></section>}
    {page==='Admin'&&<section className="admin-page"><span className="eyebrow">KANDY BEAUTY CONTROL ROOM</span><h1>Admin <em>dashboard.</em></h1>{!session?<form className="admin-login" onSubmit={adminLogin}><h2>Administrator login</h2><label>Email<input type="email" value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} required/></label><label>Password<input type="password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} required/></label><button className="primary full">SIGN IN</button></form>:!adminAllowed?<div className="admin-panel"><p>This account is signed in but does not have administrator permission yet.</p><button className="outline" onClick={()=>supabase.auth.signOut()}>SIGN OUT</button></div>:<div className="admin-panel"><div className="admin-toolbar"><button className={adminTab==='products'?'chosen':''} onClick={()=>{setAdminTab('products');refreshProducts()}}>Products</button><button className={adminTab==='orders'?'chosen':''} onClick={()=>{setAdminTab('orders');loadOrders()}}>Orders ({orders.length})</button><button onClick={()=>supabase.auth.signOut()}>Sign out</button></div>{adminTab==='products'&&<><div className="admin-heading"><h2>Manage products</h2><button className="primary" onClick={startNewProduct}>ADD PRODUCT +</button></div><form className="product-form" onSubmit={saveProduct}><h3>{editing?'Edit product':'Add a product'}</h3><div className="form-grid"><label>Product name<input value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})} required/></label><label>Category<select value={productForm.category} onChange={e=>setProductForm({...productForm,category:e.target.value})}>{['Gloss','Lipstick','Liner','Tint','Care'].map(x=><option key={x}>{x}</option>)}</select></label><label>Price (N$)<input type="number" min="0" step="0.01" value={productForm.price} onChange={e=>setProductForm({...productForm,price:e.target.value})} required/></label><label>Stock quantity<input type="number" min="0" step="1" value={productForm.stock} onChange={e=>setProductForm({...productForm,stock:e.target.value})} required/></label><label>Shade<input value={productForm.shade} onChange={e=>setProductForm({...productForm,shade:e.target.value})}/></label><label>Tag<input value={productForm.tag} onChange={e=>setProductForm({...productForm,tag:e.target.value})}/></label><label className="wide">Description<textarea value={productForm.description} onChange={e=>setProductForm({...productForm,description:e.target.value})}/></label><label className="wide">Product image<input type="file" accept="image/*" onChange={e=>uploadImage(e.target.files?.[0])}/>{productForm.image_url&&<small>Image uploaded and ready.</small>}</label><label className="check-label"><input type="checkbox" checked={productForm.published} onChange={e=>setProductForm({...productForm,published:e.target.checked})}/> Publish product on the shop</label></div><button className="primary" disabled={saving}>{saving?'SAVING…':'SAVE PRODUCT'}</button>{editing&&<button type="button" className="outline" onClick={startNewProduct}>CANCEL EDIT</button>}</form><div className="admin-products"><h3>Current products</h3>{products.length===0?<p>No published products yet. Add your real products above.</p>:products.map(p=><div className="admin-product" key={p.id}><div><b>{p.name}</b><small>{p.category} · {money(Number(p.price))} · Stock: {p.stock}</small></div><button className="outline" onClick={()=>startEditProduct(p)}>EDIT</button><button className="remove" onClick={()=>deleteProduct(p.id)}>DELETE</button></div>)}</div></>}{adminTab==='orders'&&<div className="admin-orders"><h2>Customer orders</h2>{orders.length===0?<p>No orders received yet.</p>:orders.map(o=><article className="order-card" key={o.id}><div className="order-top"><b>{o.customer_name} · {money(Number(o.total))}</b><small>{new Date(o.created_at).toLocaleString()}</small></div><p>{o.town} {o.note&&'· '+o.note}</p><ul>{(o.order_items||[]).map(item=><li key={item.id}>{item.product_name} ({item.shade}) × {item.quantity}</li>)}</ul><label>Status <select value={o.status} onChange={e=>updateOrder(o.id,e.target.value)}>{['new','confirmed','fulfilled','cancelled'].map(s=><option key={s}>{s}</option>)}</select></label></article>)}</div>}</div>}</section>}
    <footer><div className="footer-brand">KANDY <i>BEAUTY</i><small>YOUR BEAUTY, YOUR WAY</small></div><p>A little glow goes a long way. ♡</p><div className="footer-links"><button onClick={()=>go('Shop')}>Shop</button><button onClick={()=>go('About')}>Our story</button><button onClick={()=>go('Contact')}>Contact</button><a href="https://instagram.com/kandybeauty_na" target="_blank" rel="noreferrer">Instagram</a><button onClick={openAdmin}>Admin</button></div><small>© {new Date().getFullYear()} KANDY BEAUTY. All rights reserved.</small></footer>
    {notice&&<div className="toast">{notice}</div>}
  </>
}

function ProductGrid({items,add,open,loading}){return <section className="products">{loading?<p>Loading the KANDY collection…</p>:items.length===0?<p className="empty-products">No products are published yet. Check back soon. ♡</p>:items.map(p=><article className="product-card" key={p.id}><button className="product-image" onClick={()=>open(p)}>{p.image_url?<img src={p.image_url} alt={p.name}/>:<div className="bottle"><span>KANDY<br/>BEAUTY</span></div>}<span className="product-tag">{p.tag}</span><span className="quick-view">VIEW PRODUCT ↗</span></button><div className="product-meta"><div><h3>{p.name}</h3><p>{p.shade}</p></div><b>{money(Number(p.price))}</b></div><button className="add-btn" disabled={p.stock<1} onClick={()=>add(p)}>{p.stock<1?'SOLD OUT':'ADD TO BAG +'}</button></article>)}</section>}
createRoot(document.getElementById('root')).render(<App/>)
