import { Link } from 'react-router-dom'
import type { PostMeta } from '../lib/posts'
import { formatDate, initialsOf } from '../lib/text'
import { ClockIcon, FolderIcon } from './Icons'

interface PostCardProps {
  post: PostMeta
  variant?: 'default' | 'featured' | 'compact'
}

export function PostCard({ post, variant = 'default' }: PostCardProps) {
  const className = `card${variant === 'featured' ? ' card--featured' : ''}${
    variant === 'compact' ? ' card--compact' : ''
  }`

  return (
    <article className={className}>
      <div className="card__meta">
        <span className="tag">{post.category}</span>
        {variant !== 'compact' && <span className="badge badge--level">{post.level}</span>}
      </div>

      <h3 className="card__title">
        <Link to={`/posts/${post.slug}`}>{post.title}</Link>
      </h3>

      <p className="card__excerpt">{post.excerpt}</p>

      <div className="card__footer">
        <span className="author-block">
          <span className="avatar" aria-hidden="true">
            {initialsOf(post.author)}
          </span>
          <span>
            <span className="author-block__name">{post.author}</span>
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="article__meta-item" title={formatDate(post.date)}>
            <FolderIcon />
            {formatDate(post.date)}
          </span>
          <span className="article__meta-item" title={`${post.words} words`}>
            <ClockIcon />
            {post.readingMinutes} min
          </span>
        </span>
      </div>
    </article>
  )
}
